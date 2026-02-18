#!/usr/bin/env python3
"""
Create simple mouse pointer icons for OpenBrowser extension.
Based on the visual-mouse.ts pointer design but simplified.
"""

from PIL import Image, ImageDraw
import os

def create_mouse_icon(size):
    """Create a simple mouse pointer icon."""
    # Create transparent image
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Colors from visual-mouse.ts
    pointer_color = (59, 130, 246)  # #3B82F6 blue
    white = (255, 255, 255, 255)
    
    if size <= 16:
        # For small sizes, create a simple blue triangle
        points = [
            (size//4, size//4),           # top-left
            (size*3//4, size//2),         # right-middle
            (size//4, size*3//4),         # bottom-left
        ]
        draw.polygon(points, fill=pointer_color)
        return img
    
    # For larger sizes, create a more detailed mouse pointer
    # Scale the mouse path coordinates from visual-mouse.ts
    # Original coordinates (for 48x48):
    # M12 8 L36 24 L24 25.5 L19 40 L12 8 Z
    
    scale = size / 48
    # Scale the coordinates
    points = [
        (12 * scale, 8 * scale),      # top-left
        (36 * scale, 24 * scale),     # right tip
        (24 * scale, 25.5 * scale),   # inner right
        (19 * scale, 40 * scale),     # bottom
        (12 * scale, 8 * scale),      # back to top-left
    ]
    
    # First draw a white border (slightly larger)
    border_points = [
        ((12-1) * scale, (8-1) * scale),      # top-left with offset
        ((36+1) * scale, (24+1) * scale),     # right tip with offset
        ((24+1) * scale, (25.5+1) * scale),   # inner right with offset
        ((19+1) * scale, (40+1) * scale),     # bottom with offset
        ((12-1) * scale, (8-1) * scale),      # back to start
    ]
    
    # Draw white border (thicker for larger sizes)
    border_width = max(1, int(scale * 2))
    for i in range(border_width):
        offset = i / border_width
        offset_points = [
            ((12-1+offset) * scale, (8-1+offset) * scale),
            ((36+1-offset) * scale, (24+1-offset) * scale),
            ((24+1-offset) * scale, (25.5+1-offset) * scale),
            ((19+1-offset) * scale, (40+1-offset) * scale),
            ((12-1+offset) * scale, (8-1+offset) * scale),
        ]
        draw.polygon(offset_points, fill=white)
    
    # Draw main blue pointer
    draw.polygon(points, fill=pointer_color)
    
    # Add a simple inner highlight for larger icons
    if size >= 48:
        highlight_points = [
            (14 * scale, 10 * scale),      # inner top-left
            (30 * scale, 22 * scale),      # inner right
            (24 * scale, 23 * scale),      # inner right middle
            (20 * scale, 34 * scale),      # inner bottom
            (14 * scale, 10 * scale),      # back to start
        ]
        # Light blue highlight
        highlight_color = (147, 197, 253, 128)  # #93C5FD with 50% opacity
        draw.polygon(highlight_points, fill=highlight_color)
    
    return img

def main():
    """Generate mouse icons in all required sizes."""
    sizes = [16, 48, 128]
    output_dir = "extension/assets"
    
    # Ensure output directory exists
    os.makedirs(output_dir, exist_ok=True)
    
    for size in sizes:
        print(f"Creating {size}x{size} mouse icon...")
        icon = create_mouse_icon(size)
        
        # Save as PNG
        output_path = os.path.join(output_dir, f"icon{size}.png")
        icon.save(output_path, "PNG")
        print(f"  Saved to {output_path}")
        
        # Create SVG for 16px as well
        if size == 16:
            svg_path = os.path.join(output_dir, "icon16.svg")
            with open(svg_path, "w") as f:
                # Simple SVG version of mouse pointer
                f.write(f'''<?xml version="1.0" encoding="UTF-8"?>
<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
  <!-- Simple mouse pointer -->
  <path d="M4 3 L12 8 L8 9 L6 13 L4 3 Z" 
        fill="#3B82F6" 
        stroke="white" 
        stroke-width="0.5"/>
</svg>''')
            print(f"  SVG saved to {svg_path}")
    
    print("\n✅ Mouse pointer icons created successfully!")

if __name__ == "__main__":
    main()