export interface SchedulerCommand<T = unknown> {
  data: T;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  addedAt: number;
  conversationKey: string;
  isHeavy: boolean;
}

export interface CommandSchedulerOptions<T = unknown, R = unknown> {
  processCommand: (data: T) => Promise<R>;
  getConversationKey?: (data: T) => string;
  isHeavyCommand?: (data: T) => boolean;
  maxConcurrentCommands?: number;
  maxConcurrentHeavyCommands?: number;
  warnQueueLength?: number;
  warnWaitMs?: number;
  now?: () => number;
}

export interface CommandSchedulerStatus {
  queueLength: number;
  activeCount: number;
  activeHeavyCount: number;
  activeConversations: string[];
}

const DEFAULT_MAX_CONCURRENT_COMMANDS = 3;
const DEFAULT_MAX_CONCURRENT_HEAVY_COMMANDS = 2;
const DEFAULT_WARN_QUEUE_LENGTH = 3;
const DEFAULT_WARN_WAIT_MS = 5000;

export class CommandScheduler<T = unknown, R = unknown> {
  private readonly processCommand: (data: T) => Promise<R>;
  private readonly getConversationKey: (data: T) => string;
  private readonly isHeavyCommand: (data: T) => boolean;
  private readonly maxConcurrentCommands: number;
  private readonly maxConcurrentHeavyCommands: number;
  private readonly warnQueueLength: number;
  private readonly warnWaitMs: number;
  private readonly now: () => number;

  private readonly queues = new Map<string, SchedulerCommand<T>[]>();
  private readonly conversationOrder: string[] = [];
  private readonly activeConversations = new Set<string>();

  private activeCount = 0;
  private activeHeavyCount = 0;
  private drainScheduled = false;
  private roundRobinCursor = 0;

  constructor(options: CommandSchedulerOptions<T, R>) {
    this.processCommand = options.processCommand;
    this.getConversationKey =
      options.getConversationKey ??
      ((data: T) => {
        const maybeConversationId = (data as { conversation_id?: unknown })
          ?.conversation_id;
        const maybeTabId = (data as { tab_id?: unknown })?.tab_id;
        if (typeof maybeConversationId === 'string' && maybeConversationId) {
          return maybeConversationId;
        }
        if (typeof maybeTabId === 'number') {
          return `tab:${maybeTabId}`;
        }
        return '__global__';
      });
    this.isHeavyCommand = options.isHeavyCommand ?? (() => false);
    this.maxConcurrentCommands = Math.max(
      1,
      options.maxConcurrentCommands ?? DEFAULT_MAX_CONCURRENT_COMMANDS,
    );
    this.maxConcurrentHeavyCommands = Math.max(
      1,
      options.maxConcurrentHeavyCommands ??
        DEFAULT_MAX_CONCURRENT_HEAVY_COMMANDS,
    );
    this.warnQueueLength = Math.max(
      1,
      options.warnQueueLength ?? DEFAULT_WARN_QUEUE_LENGTH,
    );
    this.warnWaitMs = Math.max(0, options.warnWaitMs ?? DEFAULT_WARN_WAIT_MS);
    this.now = options.now ?? (() => Date.now());
  }

  async enqueue(data: T): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      const conversationKey = this.getConversationKey(data);
      const queue = this.ensureQueue(conversationKey);
      queue.push({
        data,
        resolve: (value) => resolve(value as R),
        reject,
        addedAt: this.now(),
        conversationKey,
        isHeavy: this.isHeavyCommand(data),
      });

      if (this.getQueueLength() > this.warnQueueLength) {
        console.warn(
          `⚠️ Command scheduler backlog: ${this.getQueueLength()} commands pending`,
        );
      }

      this.scheduleDrain();
    });
  }

  clearQueue(reason: string = 'Command queue cleared'): void {
    for (const queue of this.queues.values()) {
      for (const command of queue) {
        command.reject(new Error(reason));
      }
    }

    this.queues.clear();
    this.conversationOrder.length = 0;
    this.roundRobinCursor = 0;
  }

  getStatus(): CommandSchedulerStatus {
    return {
      queueLength: this.getQueueLength(),
      activeCount: this.activeCount,
      activeHeavyCount: this.activeHeavyCount,
      activeConversations: Array.from(this.activeConversations),
    };
  }

  private ensureQueue(conversationKey: string): SchedulerCommand<T>[] {
    let queue = this.queues.get(conversationKey);
    if (!queue) {
      queue = [];
      this.queues.set(conversationKey, queue);
      this.conversationOrder.push(conversationKey);
    }
    return queue;
  }

  private getQueueLength(): number {
    let total = 0;
    for (const queue of this.queues.values()) {
      total += queue.length;
    }
    return total;
  }

  private scheduleDrain(): void {
    if (this.drainScheduled) {
      return;
    }

    this.drainScheduled = true;
    queueMicrotask(() => {
      this.drainScheduled = false;
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    while (this.activeCount < this.maxConcurrentCommands) {
      const next = this.dequeueNextCommand();
      if (!next) {
        break;
      }

      this.launch(next);
    }
  }

  private dequeueNextCommand(): {
    conversationKey: string;
    command: SchedulerCommand<T>;
  } | null {
    this.pruneConversationOrder();

    if (this.conversationOrder.length === 0) {
      return null;
    }

    const orderSnapshot = [...this.conversationOrder];
    const startIndex = this.roundRobinCursor % orderSnapshot.length;

    for (let offset = 0; offset < orderSnapshot.length; offset += 1) {
      const snapshotIndex = (startIndex + offset) % orderSnapshot.length;
      const conversationKey = orderSnapshot[snapshotIndex];

      if (this.activeConversations.has(conversationKey)) {
        continue;
      }

      const queue = this.queues.get(conversationKey);
      if (!queue || queue.length === 0) {
        continue;
      }

      const command = queue[0];
      if (
        command.isHeavy &&
        this.activeHeavyCount >= this.maxConcurrentHeavyCommands
      ) {
        continue;
      }

      queue.shift();
      const queueStillHasItems = queue.length > 0;
      if (queue.length === 0) {
        this.queues.delete(conversationKey);
      }

      const liveIndex = this.conversationOrder.indexOf(conversationKey);
      if (this.conversationOrder.length === 0) {
        this.roundRobinCursor = 0;
      } else if (liveIndex === -1) {
        this.roundRobinCursor = 0;
      } else if (queueStillHasItems) {
        this.roundRobinCursor = (liveIndex + 1) % this.conversationOrder.length;
      } else {
        this.roundRobinCursor = liveIndex % this.conversationOrder.length;
      }

      this.pruneConversationOrder();

      return { conversationKey, command };
    }

    return null;
  }

  private launch(next: {
    conversationKey: string;
    command: SchedulerCommand<T>;
  }): void {
    const { conversationKey, command } = next;
    this.activeConversations.add(conversationKey);
    this.activeCount += 1;
    if (command.isHeavy) {
      this.activeHeavyCount += 1;
    }

    const waitTime = this.now() - command.addedAt;
    if (waitTime > this.warnWaitMs) {
      console.warn(`⌛ Command waited ${waitTime}ms in scheduler queue`);
    }

    void this.executeCommand(conversationKey, command);
  }

  private async executeCommand(
    conversationKey: string,
    command: SchedulerCommand<T>,
  ): Promise<void> {
    try {
      const result = await this.processCommand(command.data);
      command.resolve(result);
    } catch (error) {
      command.reject(error as Error);
    } finally {
      this.activeConversations.delete(conversationKey);
      this.activeCount = Math.max(0, this.activeCount - 1);
      if (command.isHeavy) {
        this.activeHeavyCount = Math.max(0, this.activeHeavyCount - 1);
      }

      this.scheduleDrain();
    }
  }

  private pruneConversationOrder(): void {
    for (
      let index = this.conversationOrder.length - 1;
      index >= 0;
      index -= 1
    ) {
      const conversationKey = this.conversationOrder[index];
      const queue = this.queues.get(conversationKey);
      if (queue && queue.length > 0) {
        continue;
      }

      this.conversationOrder.splice(index, 1);
      if (this.roundRobinCursor >= this.conversationOrder.length) {
        this.roundRobinCursor = 0;
      }
    }
  }
}
