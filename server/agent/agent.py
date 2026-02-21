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
from datetime import datetime
from typing import Dict, List, Any, Optional, Union, AsyncGenerator
from collections.abc import Sequence

from openhands.sdk import (
    LLM,
    Agent,
    AgentContext,
    Conversation,
    Event,
    ImageContent,
    TextContent,
    LLMConvertibleEvent,
    Message,
    Tool,
    get_logger,
)
from openhands.sdk.event import (
    ActionEvent,
    ObservationEvent,
    ObservationBaseEvent,
    UserRejectObservation,
    AgentErrorEvent,
    MessageEvent,
    SystemPromptEvent,
    TokenEvent,
    Condensation,
    CondensationRequest,
    CondensationSummaryEvent,
    ConversationStateUpdateEvent,
    LLMCompletionLogEvent,
)
from openhands.sdk.conversation.visualizer.base import ConversationVisualizerBase
from openhands.sdk.tool import register_tool
from openhands.tools.file_editor import FileEditorTool
from openhands.tools.terminal import TerminalTool
from openhands.tools.task_tracker import TaskTrackerTool
from openhands.tools.preset.default import get_default_condenser
from .tools.open_browser_tool import OpenBrowserTool
from server.core.llm_config import llm_config_manager

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
        logger.debug(f"QueueVisualizer.on_event called for event type: {type(event).__name__}")
        
        if self.event_queue is None:
            logger.warning("QueueVisualizer.on_event called but event_queue is None")
            return
        
        try:
            # Get basic event information
            event_type = type(event).__name__
            content = event.visualize
            text_content = content.plain if content and hasattr(content, 'plain') else str(event)
            
            # Build SSE data with common fields
            sse_data = {
                "type": event_type,
                "text": text_content,
                "timestamp": getattr(event, 'timestamp', None),
            }
            
            # Handle different event types using isinstance for clarity
            # Note: ActionEvent, ObservationEvent, MessageEvent, SystemPromptEvent, etc. 
            # all inherit from LLMConvertibleEvent
            # We use separate checks for specific event types to add their unique fields
            
            # Process specific event types (mutually exclusive)
            if isinstance(event, ActionEvent):
                # ActionEvent has action attribute
                if event.action:
                    sse_data["action"] = str(event.action)
                if event.summary:
                    sse_data["summary"] = str(event.summary)
            
            elif isinstance(event, ObservationEvent):
                # ObservationEvent has observation attribute with possible image content
                obs = event.observation
                # Extract observation properties (same as original hasattr checks)
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
            
            elif isinstance(event, MessageEvent):
                # MessageEvent has llm_message with role information
                sse_data["role"] = event.llm_message.role
                # Also include activated_skills if present
                if event.activated_skills:
                    sse_data["activated_skills"] = event.activated_skills
                if event.sender:
                    sse_data["sender"] = event.sender

            # We could add more elif branches for other specific event types here:
            # elif isinstance(event, SystemPromptEvent):
            #     # Handle SystemPromptEvent specific fields

            # For any LLMConvertibleEvent, extract image content from to_llm_content
            # This is NOT mutually exclusive with the specific type checks above because:
            # - ActionEvent, ObservationEvent, MessageEvent, etc. are all LLMConvertibleEvent
            # - This check runs for ALL LLMConvertibleEvent types
            # - The 'image' not in sse_data check prevents duplicate image extraction
            #   (e.g., if ObservationEvent already found an image in observation.screenshot_data_url)
            # This preserves the original logic where image extraction was a separate step
            # that could potentially find images in any LLMConvertibleEvent
            # if isinstance(event, LLMConvertibleEvent) and 'image' not in sse_data:
            #     try:
            #         llm_content = event.to_llm_content()
            #         image_urls = []
            #         for content in llm_content:
            #             if isinstance(content, ImageContent):
            #                 image_urls.extend(content.image_urls)
            #         if image_urls:
            #             sse_data["image"] = image_urls[0]  # Take first image
            #             logger.debug(f"Added imgae for {event}")
            #     except Exception as e:
            #         logger.debug(f"Error extracting image content from {event_type}: {e}")
            # Put event in queue
            sse_event = SSEEvent("agent_event", sse_data)
            self.event_queue.put(sse_event)
            logger.debug(f"Queued SSE event: {sse_event.event_type} - type: {event_type}")
            
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
        
        # Lazy initialization of LLM (only when needed)
        self._llm: Optional[LLM] = None
        
        # Default tools
        self.default_tools = [
            Tool(name="open_browser"),        # Our browser automation tool
            Tool(name=TerminalTool.name),     # Terminal access
            Tool(name=FileEditorTool.name),   # File editing
            Tool(name=TaskTrackerTool.name),  # Task tracking
        ]
    
    @property
    def llm(self) -> LLM:
        """Lazy initialization of LLM"""
        if self._llm is None:
            self._llm = self._create_default_llm()
        return self._llm
    
    def _create_default_llm(self) -> LLM:
        """Create default LLM configuration from config file"""
        from pydantic import SecretStr
        
        # Load LLM configuration from file
        llm_config = llm_config_manager.get_llm_config()
        
        # Check if API key is configured
        if not llm_config.api_key:
            raise ValueError(
                "LLM API key is not configured. "
                "Please configure it through the web interface at http://localhost:8000/ "
                "Or use the API: POST /api/config/llm with {'api_key': 'your-key'}"
            )
        
        logger.info(f"Loading LLM configuration: model={llm_config.model}, base_url={llm_config.base_url}")
        
        return LLM(
            usage_id="openbrowser-agent",
            model=llm_config.model,
            base_url=llm_config.base_url,
            api_key=SecretStr(llm_config.api_key)
        )
    
    def create_conversation(self, conversation_id: Optional[str] = None, cwd: str = ".") -> str:
        """Create a new conversation
        
        Args:
            conversation_id: Optional conversation ID (auto-generated if None)
            cwd: Working directory for the conversation (default: current directory)
        """
        if conversation_id is None:
            conversation_id = str(uuid.uuid4())
        
        if conversation_id in self.conversations:
            raise ValueError(f"Conversation {conversation_id} already exists")
        
        # Create agent with tools
        agent_context = AgentContext(current_datetime=datetime.now())
        agent = Agent(
            llm=self.llm,
            tools=self.default_tools,
            condenser=get_default_condenser(llm=self.llm.model_copy(update={"usage_id": "condenser"})),
            agent_context=agent_context,
        )

        # Create visualizer (queue will be set when processing messages)
        visualizer = QueueVisualizer()
        
        # Create conversation with specified workspace
        conversation = Conversation(
            agent=agent,
            visualizer=visualizer,
            workspace=cwd,
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
    
    def get_or_create_conversation(self, conversation_id: str, cwd: str = ".") -> ConversationState:
        """Get existing conversation or create a new one with the given ID
        
        Args:
            conversation_id: Conversation ID to get or create
            cwd: Working directory for the conversation (default: current directory)
        """
        conv_state = self.get_conversation(conversation_id)
        if conv_state:
            return conv_state
        
        # Conversation doesn't exist, create it
        if conversation_id in self.conversations:
            # Race condition: conversation was just created by another thread
            return self.conversations[conversation_id]
        
        # Create new conversation with the given ID
        # Create agent with tools
        agent_context = AgentContext(current_datetime=datetime.now())
        agent = Agent(llm=self.llm, tools=self.default_tools, agent_context=agent_context)
        
        # Create visualizer (queue will be set when processing messages)
        visualizer = QueueVisualizer()
        
        # Create conversation with specified workspace
        conversation = Conversation(
            agent=agent,
            visualizer=visualizer,
            workspace=cwd,
        )
        
        # Store conversation state
        self.conversations[conversation_id] = ConversationState(
            conversation_id=conversation_id,
            conversation=conversation,
            visualizer=visualizer,
        )
        
        logger.debug(f"Created new conversation with ID: {conversation_id}")
        return self.conversations[conversation_id]
    
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

async def create_agent_conversation(conversation_id: Optional[str] = None, cwd: str = ".") -> str:
    """Create a new agent conversation
    
    Args:
        conversation_id: Optional conversation ID (auto-generated if None)
        cwd: Working directory for the conversation (default: current directory)
    """
    return agent_manager.create_conversation(conversation_id, cwd)


async def process_agent_message(
    conversation_id: str,
    message_text: str,
    cwd: str = "."
) -> AsyncGenerator[str, None]:
    """Process a message and yield SSE events using thread-based execution
    
    Args:
        conversation_id: Conversation ID to process message in
        message_text: Message text to send to agent
        cwd: Working directory for the conversation if creating new (default: current directory)
    """
    logger.debug(f"DEBUG: process_agent_message called with conversation_id={conversation_id}, message='{message_text[:50]}...', cwd={cwd}")
    logger.info(f"Processing agent message for conversation {conversation_id}: '{message_text[:50]}...'")
    logger.debug(f"Processing agent message for conversation {conversation_id}: '{message_text[:50]}...'")
    
    conv_state = agent_manager.get_or_create_conversation(conversation_id, cwd)
    logger.debug(f"DEBUG: Using conversation {conversation_id} (created if new)")
    
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
            logger.debug(f"DEBUG: run_conversation starting for {conversation_id}")
            logger.debug(f"Starting conversation execution in thread for {conversation_id}")
            
            # Set up event loop for this thread
            import asyncio
            try:
                loop = asyncio.get_event_loop()
                logger.debug(f"DEBUG: Using existing event loop in thread")
            except RuntimeError:
                logger.debug(f"DEBUG: Creating new event loop for thread")
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
            
            # Send user message to conversation
            logger.debug(f"DEBUG: Sending message to conversation")
            conv_state.conversation.send_message(message_text)
            
            # Run the conversation (check if it's async or sync)
            import inspect
            run_method = conv_state.conversation.run
            
            if inspect.iscoroutinefunction(run_method):
                logger.debug(f"DEBUG: conversation.run() is async, running in thread event loop")
                try:
                    logger.debug(f"DEBUG: Running async conversation.run()")
                    loop.run_until_complete(run_method())
                    logger.debug(f"DEBUG: Async conversation.run() completed successfully")
                finally:
                    pass  # Don't close the loop - tools might still need it
            else:
                logger.debug(f"DEBUG: conversation.run() is sync, calling directly")
                run_method()
                logger.debug(f"DEBUG: Sync conversation.run() completed successfully")
            logger.debug(f"Conversation {conversation_id} execution completed")
            logger.debug(f"DEBUG: Putting complete event into queue")
            # Put completion event in queue
            event_queue.put(SSEEvent("complete", {
                "conversation_id": conversation_id,
                "message": "Conversation completed"
            }))
            logger.debug(f"DEBUG: Complete event put into queue")
            
        except Exception as e:
            logger.debug(f"DEBUG: Exception in run_conversation: {e}")
            import traceback
            logger.error(traceback.format_exc())
            logger.error(f"Error running conversation in thread: {e}")
            conversation_error = e
            # Put error event in queue
            event_queue.put(SSEEvent("error", {
                "conversation_id": conversation_id,
                "error": str(e)
            }))
        finally:
            logger.debug(f"DEBUG: run_conversation finally block, setting conversation_finished=True")
            conversation_finished = True
            logger.debug(f"DEBUG: conversation_finished set to True in thread")
            conv_state.conversation.close()
            logger.debug(f"DEBUG: closed conversation")
    
    # Start conversation thread
    conversation_thread = threading.Thread(target=run_conversation, daemon=True)
    conversation_thread.start()
    logger.debug(f"Started conversation thread for {conversation_id}")
    
    try:
        # Yield events as they arrive from the queue
        timeout_seconds = 600.0  # Timeout for idle time (no events for 10 minutes)
        last_event_time = time.time()
        
        while True:
            # Debug: print queue size
            logger.debug(f"DEBUG: Queue size: {event_queue.qsize()}, conversation_finished: {conversation_finished}")
            
            # Check if conversation thread has finished
            if conversation_finished and event_queue.empty():
                logger.debug(f"Conversation thread finished and queue empty for {conversation_id}")
                logger.debug(f"DEBUG: Conversation finished and queue empty, breaking loop")
                break
            
            # Check for idle timeout (no events received for timeout_seconds)
            idle_time = time.time() - last_event_time
            if idle_time > timeout_seconds:
                logger.warning(f"Timeout waiting for events from conversation {conversation_id} (idle for {idle_time:.1f}s)")
                yield SSEEvent("error", {
                    "conversation_id": conversation_id,
                    "error": "Timeout waiting for agent response"
                }).to_sse_format()
                break
            
            try:
                # Use asyncio to wait for queue item without blocking event loop
                loop = asyncio.get_event_loop()
                try:
                    # Wait for event with timeout based on remaining idle time
                    # Calculate remaining time before idle timeout
                    remaining_time = max(10.0, timeout_seconds - idle_time)  # Minimum 10 seconds to reduce log noise
                    logger.debug(f"DEBUG: Waiting for event from queue (timeout: {remaining_time:.1f}s, idle: {idle_time:.1f}s)...")
                    sse_event = await loop.run_in_executor(
                        None, event_queue.get, remaining_time
                    )
                    # Reset idle timer when we get an event
                    last_event_time = time.time()
                    logger.debug(f"DEBUG: Got SSE event from queue: {sse_event.event_type}")
                except queue.Empty:
                    # Continue loop to check other conditions
                    logger.debug(f"DEBUG: Queue empty after waiting, checking conversation_finished: {conversation_finished}")
                    continue
                
                # Check if this is a completion or error event
                if sse_event.event_type in ["complete", "error"]:
                    logger.debug(f"Yielding {sse_event.event_type} event for conversation {conversation_id}")
                    logger.debug(f"DEBUG: Yielding {sse_event.event_type} event")
                    yield sse_event.to_sse_format()
                    
                    # If it's an error from the conversation thread, we should break
                    if sse_event.event_type == "error":
                        break
                    
                    # For completion events, drain remaining events from queue
                    logger.debug(f"DEBUG: Draining remaining events from queue...")
                    drained_count = 0
                    while True:
                        try:
                            next_event = event_queue.get_nowait()
                            logger.debug(f"DEBUG: Draining event #{drained_count + 1}: {next_event.event_type}")
                            yield next_event.to_sse_format()
                            drained_count += 1
                        except queue.Empty:
                            logger.debug(f"DEBUG: Queue empty after draining {drained_count} events")
                            break
                    
                    break
                else:
                    # Yield regular event
                    logger.debug(f"Yielding SSE event for conversation {conversation_id}: {sse_event.event_type}")
                    logger.debug(f"DEBUG: Yielding regular SSE event: {sse_event.event_type}")
                    sse_format = sse_event.to_sse_format()
                    logger.debug(f"DEBUG: SSE format string (first 500 chars): {sse_format[:500]}")
                    yield sse_format
                    
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