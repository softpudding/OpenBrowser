"""
OpenBrowserAgent - AI agent for browser automation with visual feedback.

This module provides the main agent logic for controlling Chrome browser
through natural language commands with real-time visual feedback.
"""

import asyncio
import json
import logging
import uuid
import threading
import queue
import time
from dataclasses import dataclass, field
from typing import Dict, List, Any, Optional, Union, AsyncGenerator
from collections.abc import Sequence

from openhands.sdk import (
    LLM,
    Agent,
    Conversation,
    Event,
    ImageContent,
    TextContent,
    LLMConvertibleEvent,
    Message,
    Tool,
    get_logger,
)
from openhands.sdk.conversation.visualizer.base import ConversationVisualizerBase
from openhands.sdk.tool import register_tool
from openhands.tools.file_editor import FileEditorTool
from openhands.tools.terminal import TerminalTool
from openhands.tools.task_tracker import TaskTrackerTool

from .tools.open_browser_tool import OpenBrowserTool

logger = get_logger(__name__)


# --- SSE Event Types ---

class SSEEvent:
    """Server-Sent Event for streaming responses"""
    
    def __init__(self, event_type: str, data: Any):
        self.event_type = event_type
        self.data = data
    
    def to_sse_format(self) -> str:
        """Convert to SSE format string"""
        if isinstance(self.data, str):
            data_str = self.data
        else:
            data_str = json.dumps(self.data, ensure_ascii=False)
        
        # Escape newlines in data
        data_str = data_str.replace('\n', '\\n')
        
        return f"event: {self.event_type}\ndata: {data_str}\n\n"


# --- Queue-based Visualizer for SSE Streaming ---

class QueueVisualizer(ConversationVisualizerBase):
    """Visualizer that puts events into a queue for SSE streaming"""
    
    def __init__(self, event_queue: queue.Queue = None):
        """
        Args:
            event_queue: queue.Queue to put visualized events into (can be set later)
        """
        super().__init__()
        self.event_queue = event_queue
    
    def set_event_queue(self, event_queue: queue.Queue) -> None:
        """Set the event queue (useful for delayed initialization)"""
        self.event_queue = event_queue
    
    def on_event(self, event: Event) -> None:
        """Handle conversation events and put them into the queue"""
        print(f"DEBUG: QueueVisualizer.on_event called! Event type: {type(event).__name__}")
        print(f"DEBUG: Event dir: {[attr for attr in dir(event) if not attr.startswith('_')]}")
        if self.event_queue is None:
            logger.warning("QueueVisualizer.on_event called but event_queue is None")
            print(f"DEBUG: ERROR - event_queue is None!")
            return
            
        try:
            # Log event for debugging
            event_type = type(event).__name__
            logger.debug(f"QueueVisualizer event: {event_type} - {str(event)[:100]}")
            print(f"DEBUG: QueueVisualizer processing event: {event_type} - {str(event)[:200]}")
            print(f"DEBUG: Event has observation attr: {hasattr(event, 'observation')}")
            if hasattr(event, 'observation'):
                obs = event.observation
                print(f"DEBUG: Observation type: {type(obs)}")
                print(f"DEBUG: Observation dir: {[attr for attr in dir(obs) if not attr.startswith('_')]}")
                print(f"DEBUG: Observation has success: {hasattr(obs, 'success')}")
                print(f"DEBUG: Observation has screenshot_data_url: {hasattr(obs, 'screenshot_data_url')}")
                if hasattr(obs, 'screenshot_data_url'):
                    print(f"DEBUG: screenshot_data_url exists: {obs.screenshot_data_url is not None}")
                    if obs.screenshot_data_url:
                        print(f"DEBUG: screenshot_data_url length: {len(obs.screenshot_data_url)}")
            print(f"DEBUG: Event has action attr: {hasattr(event, 'action')}")
            if hasattr(event, 'action'):
                print(f"DEBUG: Action: {event.action}")
            
            # Use event.visualize to get the content (like DefaultConversationVisualizer)
            content = event.visualize
            logger.debug(f"Event visualize content type: {type(content)}, has plain: {hasattr(content, 'plain')}")
            print(f"DEBUG: Event.visualize result: type={type(content)}, content={str(content)[:200] if content else 'None'}")
            text_content = content.plain if content and hasattr(content, 'plain') else str(event)
            print(f"DEBUG: Text content: {text_content[:200] if text_content else 'None'}")
            
            # Create SSE event data
            sse_data = {
                "type": event_type,
                "text": text_content,
                "timestamp": getattr(event, 'timestamp', None),
            }
            
            # Add event-specific data
            if hasattr(event, 'action'):
                sse_data["action"] = str(event.action)
            
            if hasattr(event, 'observation'):
                obs = event.observation
                if hasattr(obs, 'success'):
                    sse_data["success"] = obs.success
                if hasattr(obs, 'message'):
                    sse_data["message"] = obs.message
                if hasattr(obs, 'error'):
                    sse_data["error"] = obs.error
                
                # Check for image content in observations (especially for open_browser tool)
                if hasattr(obs, 'screenshot_data_url') and obs.screenshot_data_url:
                    sse_data["image"] = obs.screenshot_data_url
                elif hasattr(obs, 'image_url') and obs.image_url:
                    sse_data["image"] = obs.image_url
                elif hasattr(obs, 'image') and obs.image:
                    sse_data["image"] = obs.image
            
            # Also extract any ImageContent from LLMConvertibleEvent
            if isinstance(event, LLMConvertibleEvent) and hasattr(event, 'to_llm_content'):
                try:
                    llm_content = event.to_llm_content()
                    image_urls = []
                    for content in llm_content:
                        if isinstance(content, ImageContent):
                            image_urls.extend(content.image_urls)
                    
                    if image_urls and 'image' not in sse_data:
                        sse_data["images"] = image_urls
                except Exception as e:
                    logger.debug(f"Error extracting image content from {event_type}: {e}")
            
            # Put event in queue
            sse_event = SSEEvent("agent_event", sse_data)
            self.event_queue.put(sse_event)
            logger.debug(f"Queued SSE event: {sse_event.event_type} - {json.dumps(sse_data, ensure_ascii=False)[:200]}")
            
        except Exception as e:
            logger.error(f"Error processing event in QueueVisualizer: {e}")
            # Put error event in queue
            error_event = SSEEvent("error", {
                "type": "error",
                "message": f"Error processing event: {str(e)}"
            })
            try:
                self.event_queue.put(error_event)
            except:
                pass


# --- Agent Manager ---

@dataclass
class ConversationState:
    """State for a conversation"""
    conversation_id: str
    conversation: Conversation
    visualizer: QueueVisualizer
    created_at: float = field(default_factory=time.time)


class OpenBrowserAgentManager:
    """Manages agent instances and conversations"""
    
    def __init__(self):
        self.conversations: Dict[str, ConversationState] = {}
        
        # Default LLM configuration (can be overridden)
        self.llm = self._create_default_llm()
        
        # Default tools
        self.default_tools = [
            Tool(name="open_browser"),        # Our browser automation tool
            Tool(name=TerminalTool.name),     # Terminal access
            Tool(name=FileEditorTool.name),   # File editing
            Tool(name=TaskTrackerTool.name),  # Task tracking
        ]
    
    def _create_default_llm(self) -> LLM:
        """Create default LLM configuration"""
        import os
        from pydantic import SecretStr
        
        api_key = os.getenv("LLM_API_KEY")
        model = os.getenv("LLM_MODEL", "anthropic/claude-sonnet-4-5-20250929")
        base_url = os.getenv("LLM_BASE_URL")
        
        return LLM(
            usage_id="openbrowser-agent",
            model=model,
            base_url=base_url,
            api_key=SecretStr(api_key) if api_key else None,
        )
    
    def create_conversation(self, conversation_id: Optional[str] = None) -> str:
        """Create a new conversation"""
        if conversation_id is None:
            conversation_id = str(uuid.uuid4())
        
        if conversation_id in self.conversations:
            raise ValueError(f"Conversation {conversation_id} already exists")
        
        # Create agent with tools
        agent = Agent(llm=self.llm, tools=self.default_tools)
        
        # Create visualizer (queue will be set when processing messages)
        visualizer = QueueVisualizer()
        
        # Create conversation
        conversation = Conversation(
            agent=agent,
            visualizer=visualizer,
            workspace=".",  # Current directory
        )
        
        # Store conversation state
        self.conversations[conversation_id] = ConversationState(
            conversation_id=conversation_id,
            conversation=conversation,
            visualizer=visualizer,
        )
        
        return conversation_id
    
    def get_conversation(self, conversation_id: str) -> Optional[ConversationState]:
        """Get conversation by ID"""
        return self.conversations.get(conversation_id)
    
    def delete_conversation(self, conversation_id: str) -> bool:
        """Delete a conversation"""
        if conversation_id in self.conversations:
            del self.conversations[conversation_id]
            return True
        return False
    
    def list_conversations(self) -> List[Dict[str, Any]]:
        """List all conversations"""
        return [
            {
                "id": conv.conversation_id,
                "created_at": conv.created_at,
                "agent_id": id(conv.conversation.agent),
            }
            for conv in self.conversations.values()
        ]
    
    async def process_message(
        self,
        conversation_id: str,
        message_text: str,
        event_callback: callable = None
    ) -> AsyncGenerator[SSEEvent, None]:
        """Process a user message and stream events"""
        conv_state = self.get_conversation(conversation_id)
        if not conv_state:
            raise ValueError(f"Conversation {conversation_id} not found")
        
        # Set event callback on visualizer
        conv_state.visualizer.event_callback = event_callback
        
        try:
            # Send user message
            conv_state.conversation.send_message(message_text)
            
            # Run conversation (this will trigger visualizer callbacks)
            await conv_state.conversation.run_async()
            
            # Yield completion event
            yield SSEEvent("complete", {"conversation_id": conversation_id})
            
        except Exception as e:
            logger.error(f"Error processing message: {e}")
            yield SSEEvent("error", {
                "conversation_id": conversation_id,
                "error": str(e)
            })
        
        finally:
            # Clear callback
            conv_state.visualizer.event_callback = None


# Global agent manager instance
agent_manager = OpenBrowserAgentManager()


# --- Public API Functions ---

async def create_agent_conversation(conversation_id: Optional[str] = None) -> str:
    """Create a new agent conversation"""
    return agent_manager.create_conversation(conversation_id)


async def process_agent_message(
    conversation_id: str,
    message_text: str
) -> AsyncGenerator[str, None]:
    """Process a message and yield SSE events using thread-based execution"""
    print(f"DEBUG: process_agent_message called with conversation_id={conversation_id}, message='{message_text[:50]}...'")
    logger.info(f"Processing agent message for conversation {conversation_id}: '{message_text[:50]}...'")
    logger.debug(f"Processing agent message for conversation {conversation_id}: '{message_text[:50]}...'")
    
    conv_state = agent_manager.get_conversation(conversation_id)
    if not conv_state:
        print(f"DEBUG: Conversation {conversation_id} not found")
        raise ValueError(f"Conversation {conversation_id} not found")
    
    # Create a queue for collecting events from visualizer
    event_queue = queue.Queue()
    
    # Set the event queue on the visualizer
    conv_state.visualizer.set_event_queue(event_queue)
    logger.debug(f"Event queue set on visualizer for conversation {conversation_id}")
    
    # Flag to track if conversation thread has finished
    conversation_finished = False
    conversation_error = None
    
    def run_conversation():
        """Run the conversation in a separate thread (synchronous)"""
        nonlocal conversation_finished, conversation_error
        try:
            print(f"DEBUG: run_conversation starting for {conversation_id}")
            logger.debug(f"Starting conversation execution in thread for {conversation_id}")
            
            # Set up event loop for this thread
            import asyncio
            try:
                loop = asyncio.get_event_loop()
                print(f"DEBUG: Using existing event loop in thread")
            except RuntimeError:
                print(f"DEBUG: Creating new event loop for thread")
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
            
            # Send user message to conversation
            print(f"DEBUG: Sending message to conversation")
            conv_state.conversation.send_message(message_text)
            
            # Run the conversation (check if it's async or sync)
            import inspect
            run_method = conv_state.conversation.run
            
            if inspect.iscoroutinefunction(run_method):
                print(f"DEBUG: conversation.run() is async, running in thread event loop")
                try:
                    print(f"DEBUG: Running async conversation.run()")
                    loop.run_until_complete(run_method())
                    print(f"DEBUG: Async conversation.run() completed successfully")
                finally:
                    pass  # Don't close the loop - tools might still need it
            else:
                print(f"DEBUG: conversation.run() is sync, calling directly")
                run_method()
                print(f"DEBUG: Sync conversation.run() completed successfully")
            logger.debug(f"Conversation {conversation_id} execution completed")
            print(f"DEBUG: Putting complete event into queue")
            # Put completion event in queue
            event_queue.put(SSEEvent("complete", {
                "conversation_id": conversation_id,
                "message": "Conversation completed"
            }))
            print(f"DEBUG: Complete event put into queue")
            
        except Exception as e:
            print(f"DEBUG: Exception in run_conversation: {e}")
            import traceback
            traceback.print_exc()
            logger.error(f"Error running conversation in thread: {e}")
            conversation_error = e
            # Put error event in queue
            event_queue.put(SSEEvent("error", {
                "conversation_id": conversation_id,
                "error": str(e)
            }))
        finally:
            print(f"DEBUG: run_conversation finally block, setting conversation_finished=True")
            conversation_finished = True
            print(f"DEBUG: conversation_finished set to True in thread")
    
    # Start conversation thread
    conversation_thread = threading.Thread(target=run_conversation, daemon=True)
    conversation_thread.start()
    logger.debug(f"Started conversation thread for {conversation_id}")
    
    try:
        # Yield events as they arrive from the queue
        timeout_seconds = 30.0  # Overall timeout for conversation
        start_time = time.time()
        
        while True:
            # Debug: print queue size
            print(f"DEBUG: Queue size: {event_queue.qsize()}, conversation_finished: {conversation_finished}")
            
            # Check if conversation thread has finished
            if conversation_finished and event_queue.empty():
                logger.debug(f"Conversation thread finished and queue empty for {conversation_id}")
                print(f"DEBUG: Conversation finished and queue empty, breaking loop")
                break
            
            # Check for overall timeout
            elapsed = time.time() - start_time
            if elapsed > timeout_seconds:
                logger.warning(f"Timeout waiting for events from conversation {conversation_id}")
                yield SSEEvent("error", {
                    "conversation_id": conversation_id,
                    "error": "Timeout waiting for agent response"
                }).to_sse_format()
                break
            
            try:
                # Use asyncio to wait for queue item without blocking event loop
                loop = asyncio.get_event_loop()
                try:
                    # Wait for event with longer timeout (30 seconds total)
                    # Calculate remaining time before overall timeout
                    remaining_time = max(1.0, timeout_seconds - elapsed)
                    print(f"DEBUG: Waiting for event from queue (timeout: {remaining_time:.1f}s, elapsed: {elapsed:.1f}s)...")
                    sse_event = await loop.run_in_executor(
                        None, event_queue.get, remaining_time
                    )
                    print(f"DEBUG: Got SSE event from queue: {sse_event.event_type}")
                except queue.Empty:
                    # Continue loop to check other conditions
                    print(f"DEBUG: Queue empty after waiting, checking conversation_finished: {conversation_finished}")
                    continue
                
                # Check if this is a completion or error event
                if sse_event.event_type in ["complete", "error"]:
                    logger.debug(f"Yielding {sse_event.event_type} event for conversation {conversation_id}")
                    print(f"DEBUG: Yielding {sse_event.event_type} event")
                    yield sse_event.to_sse_format()
                    
                    # If it's an error from the conversation thread, we should break
                    if sse_event.event_type == "error":
                        break
                    
                    # For completion events, drain remaining events from queue
                    print(f"DEBUG: Draining remaining events from queue...")
                    drained_count = 0
                    while True:
                        try:
                            next_event = event_queue.get_nowait()
                            print(f"DEBUG: Draining event #{drained_count + 1}: {next_event.event_type}")
                            yield next_event.to_sse_format()
                            drained_count += 1
                        except queue.Empty:
                            print(f"DEBUG: Queue empty after draining {drained_count} events")
                            break
                    
                    break
                else:
                    # Yield regular event
                    logger.debug(f"Yielding SSE event for conversation {conversation_id}: {sse_event.event_type}")
                    print(f"DEBUG: Yielding regular SSE event: {sse_event.event_type}")
                    yield sse_event.to_sse_format()
                    
            except Exception as e:
                logger.error(f"Error processing events from queue: {e}")
                yield SSEEvent("error", {
                    "conversation_id": conversation_id,
                    "error": f"Error processing events: {str(e)}"
                }).to_sse_format()
                break
        
        # Wait for thread to finish (with timeout)
        await asyncio.get_event_loop().run_in_executor(None, conversation_thread.join, 5.0)
        if conversation_thread.is_alive():
            logger.warning(f"Conversation thread for {conversation_id} still alive after join timeout")
            
    finally:
        # Clear the event queue from visualizer
        conv_state.visualizer.set_event_queue(None)
        logger.debug(f"Cleaned up visualizer event queue for conversation {conversation_id}")


async def get_conversation_info(conversation_id: str) -> Optional[Dict[str, Any]]:
    """Get information about a conversation"""
    conv_state = agent_manager.get_conversation(conversation_id)
    if conv_state:
        return {
            "id": conv_state.conversation_id,
            "created_at": conv_state.created_at,
            "has_agent": conv_state.conversation.agent is not None,
        }
    return None


async def delete_conversation(conversation_id: str) -> bool:
    """Delete a conversation"""
    return agent_manager.delete_conversation(conversation_id)


async def list_conversations() -> List[Dict[str, Any]]:
    """List all conversations"""
    return agent_manager.list_conversations()


# --- Initialization ---

def initialize_agent():
    """Initialize the agent system"""
    logger.info("Initializing OpenBrowserAgent...")
    
    # Check if browser server is available
    try:
        from server.core.processor import command_processor
        logger.info("Browser command processor available")
    except ImportError as e:
        logger.warning(f"Browser command processor not available: {e}")
    
    # Register tools if not already registered
    try:
        from .tools.open_browser_tool import OpenBrowserTool
        logger.info("OpenBrowserTool registered")
    except Exception as e:
        logger.error(f"Failed to register OpenBrowserTool: {e}")
    
    logger.info("OpenBrowserAgent initialized")


# Initialize on module import
initialize_agent()