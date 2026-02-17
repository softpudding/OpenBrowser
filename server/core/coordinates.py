from typing import Tuple, Optional
from dataclasses import dataclass
import numpy as np

from server.core.config import config


@dataclass
class CoordinateMapping:
    """Maps coordinates between preset and actual resolutions"""
    preset_width: int
    preset_height: int
    actual_width: int
    actual_height: int
    viewport_width: Optional[int] = None  # CSS viewport width
    viewport_height: Optional[int] = None  # CSS viewport height
    
    def __post_init__(self):
        # Ensure positive dimensions
        if self.preset_width <= 0 or self.preset_height <= 0:
            raise ValueError("Preset dimensions must be positive")
        if self.actual_width <= 0 or self.actual_height <= 0:
            raise ValueError("Actual dimensions must be positive")
            
    @property
    def scale_x(self) -> float:
        """Scale factor for X coordinate"""
        return self.actual_width / self.preset_width
        
    @property
    def scale_y(self) -> float:
        """Scale factor for Y coordinate"""
        return self.actual_height / self.preset_height
        
    def preset_to_actual(self, x: int, y: int) -> Tuple[int, int]:
        """
        Convert coordinates from preset resolution to actual resolution
        
        Args:
            x: X coordinate in preset resolution space
            y: Y coordinate in preset resolution space
            
        Returns:
            Tuple of (x, y) coordinates in actual resolution space
        """
        # Clamp to preset bounds
        x = max(0, min(x, self.preset_width - 1))
        y = max(0, min(y, self.preset_height - 1))
        
        # Scale to actual resolution
        actual_x = int(x * self.scale_x)
        actual_y = int(y * self.scale_y)
        
        # Clamp to actual bounds
        actual_x = max(0, min(actual_x, self.actual_width - 1))
        actual_y = max(0, min(actual_y, self.actual_height - 1))
        
        return actual_x, actual_y
        
    def actual_to_preset(self, x: int, y: int) -> Tuple[int, int]:
        """
        Convert coordinates from actual resolution to preset resolution
        
        Args:
            x: X coordinate in actual resolution space
            y: Y coordinate in actual resolution space
            
        Returns:
            Tuple of (x, y) coordinates in preset resolution space
        """
        # Clamp to actual bounds
        x = max(0, min(x, self.actual_width - 1))
        y = max(0, min(y, self.actual_height - 1))
        
        # Scale to preset resolution
        preset_x = int(x / self.scale_x) if self.scale_x > 0 else 0
        preset_y = int(y / self.scale_y) if self.scale_y > 0 else 0
        
        # Clamp to preset bounds
        preset_x = max(0, min(preset_x, self.preset_width - 1))
        preset_y = max(0, min(preset_y, self.preset_height - 1))
        
        return preset_x, preset_y
        
    def relative_preset_to_actual(self, dx: int, dy: int) -> Tuple[int, int]:
        """
        Convert relative movement from preset to actual resolution
        
        Args:
            dx: Horizontal movement in preset resolution space
            dy: Vertical movement in preset resolution space
            
        Returns:
            Tuple of (dx, dy) movements in actual resolution space
        """
        actual_dx = int(dx * self.scale_x)
        actual_dy = int(dy * self.scale_y)
        return actual_dx, actual_dy
        
    def screenshot_to_viewport(self, screenshot_x: int, screenshot_y: int,
                               screenshot_width: int, screenshot_height: int) -> Tuple[int, int]:
        """
        Convert screenshot pixel coordinates to viewport CSS pixels
        Based on AIPex coordinate mapping logic
        
        Args:
            screenshot_x: X coordinate in screenshot pixel space
            screenshot_y: Y coordinate in screenshot pixel space
            screenshot_width: Width of screenshot in pixels
            screenshot_height: Height of screenshot in pixels
            
        Returns:
            Tuple of (x, y) coordinates in viewport CSS pixel space
        """
        if not self.viewport_width or not self.viewport_height:
            raise ValueError("Viewport dimensions not set")
            
        # Linear mapping: screenshot pixel → viewport CSS pixel
        x_css = int((screenshot_x / screenshot_width) * self.viewport_width)
        y_css = int((screenshot_y / screenshot_height) * self.viewport_height)
        
        # Boundary constraints
        x_css = max(0, min(x_css, self.viewport_width - 1))
        y_css = max(0, min(y_css, self.viewport_height - 1))
        
        return x_css, y_css


class CoordinateManager:
    """Manages coordinate mappings for different tabs"""
    
    def __init__(self):
        self._mappings: Dict[int, CoordinateMapping] = {}  # tab_id -> mapping
        self._default_preset = config.preset_resolution
        
    def create_mapping(self, tab_id: int, actual_width: int, actual_height: int,
                       viewport_width: Optional[int] = None,
                       viewport_height: Optional[int] = None) -> CoordinateMapping:
        """
        Create coordinate mapping for a tab
        
        Args:
            tab_id: Chrome tab ID
            actual_width: Actual screen/window width in pixels
            actual_height: Actual screen/window height in pixels
            viewport_width: CSS viewport width (optional)
            viewport_height: CSS viewport height (optional)
            
        Returns:
            CoordinateMapping instance
        """
        mapping = CoordinateMapping(
            preset_width=self._default_preset[0],
            preset_height=self._default_preset[1],
            actual_width=actual_width,
            actual_height=actual_height,
            viewport_width=viewport_width,
            viewport_height=viewport_height
        )
        self._mappings[tab_id] = mapping
        return mapping
        
    def get_mapping(self, tab_id: int) -> Optional[CoordinateMapping]:
        """Get coordinate mapping for a tab"""
        return self._mappings.get(tab_id)
        
    def update_viewport(self, tab_id: int, viewport_width: int, viewport_height: int):
        """Update viewport dimensions for a tab"""
        if tab_id in self._mappings:
            self._mappings[tab_id].viewport_width = viewport_width
            self._mappings[tab_id].viewport_height = viewport_height
            
    def remove_mapping(self, tab_id: int):
        """Remove coordinate mapping for a tab"""
        self._mappings.pop(tab_id, None)
        
    def clear(self):
        """Clear all coordinate mappings"""
        self._mappings.clear()


# Global coordinate manager instance
coord_manager = CoordinateManager()