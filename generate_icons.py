#!/usr/bin/env python3
"""
Generate placeholder icons for Chrome extension
"""

from PIL import Image, ImageDraw
import os

def generate_icon(size, output_path):
    """Generate a simple placeholder icon"""
    img = Image.new('RGBA', (size, size), (66, 133, 244, 255))  # Google blue
    draw = ImageDraw.Draw(img)
    
    # Draw a simple browser window icon
    margin = size // 8
    draw.rectangle([margin, margin, size - margin, size - margin], 
                   fill=(255, 255, 255, 255))
    
    # Draw address bar
    bar_height = size // 16
    draw.rectangle([margin * 2, margin * 2, size - margin * 2, margin * 2 + bar_height],
                   fill=(240, 240, 240, 255))
    
    # Draw back button
    btn_size = bar_height
    draw.rectangle([margin * 2, margin * 2, margin * 2 + btn_size, margin * 2 + btn_size],
                   fill=(200, 200, 200, 255))
    
    # Draw refresh button
    draw.rectangle([margin * 2 + btn_size + 2, margin * 2, 
                   margin * 2 + btn_size * 2 + 2, margin * 2 + btn_size],
                   fill=(200, 200, 200, 255))
    
    img.save(output_path)
    print(f"Generated {output_path}")

def main():
    # Create assets directory if it doesn't exist
    assets_dir = os.path.join(os.path.dirname(__file__), 'extension', 'assets')
    os.makedirs(assets_dir, exist_ok=True)
    
    # Generate icons in different sizes
    sizes = [16, 48, 128]
    for size in sizes:
        output_path = os.path.join(assets_dir, f'icon{size}.png')
        generate_icon(size, output_path)
    
    print("✅ Icons generated successfully")

if __name__ == '__main__':
    main()