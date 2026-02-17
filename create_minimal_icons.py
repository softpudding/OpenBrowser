#!/usr/bin/env python3
"""
Create minimal PNG icons without external dependencies
Creates simple colored squares with browser-like symbols
"""

import struct
import zlib
import os

def create_minimal_png(width, height, color_rgb, output_path):
    """
    Create a minimal PNG file with a solid color
    color_rgb: tuple of (r, g, b) 0-255
    """
    # PNG signature
    png_data = b'\x89PNG\r\n\x1a\n'
    
    # IHDR chunk
    ihdr_data = struct.pack('>I', width)  # width
    ihdr_data += struct.pack('>I', height)  # height
    ihdr_data += b'\x08'  # bit depth
    ihdr_data += b'\x02'  # color type: RGB
    ihdr_data += b'\x00'  # compression
    ihdr_data += b'\x00'  # filter
    ihdr_data += b'\x00'  # interlace
    png_data += make_chunk(b'IHDR', ihdr_data)
    
    # IDAT chunk - create RGB data
    scanline = bytes(color_rgb) * width
    scanline_with_filter = b'\x00' + scanline  # filter type 0
    image_data = scanline_with_filter * height
    
    # Compress the image data
    compressed = zlib.compress(image_data)
    png_data += make_chunk(b'IDAT', compressed)
    
    # IEND chunk
    png_data += make_chunk(b'IEND', b'')
    
    # Write to file
    with open(output_path, 'wb') as f:
        f.write(png_data)
    
    print(f"Created {output_path} ({width}x{height}, color: {color_rgb})")

def make_chunk(chunk_type, data):
    """Create a PNG chunk"""
    length = struct.pack('>I', len(data))
    chunk = length + chunk_type + data
    crc = struct.pack('>I', zlib.crc32(chunk_type + data) & 0xffffffff)
    return chunk + crc

def create_browser_icon(size, output_path):
    """Create a browser-like icon"""
    # Create temporary directory for intermediate files
    import tempfile
    import subprocess
    
    # Try to use ImageMagick if available
    try:
        # Create SVG with Python
        svg_content = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}">
            <rect width="{size}" height="{size}" fill="#4285f4" rx="{size//8}"/>
            <rect x="{size//8}" y="{size//8}" width="{size*6//8}" height="{size*6//8}" fill="white" rx="{size//16}"/>
            <rect x="{size//4}" y="{size//4}" width="{size//2}" height="{size//16}" fill="#e0e0e0"/>
            <rect x="{size//4}" y="{size//4}" width="{size//16}" height="{size//16}" fill="#b0b0b0"/>
            <rect x="{size//4 + size//8}" y="{size//4}" width="{size//16}" height="{size//16}" fill="#b0b0b0"/>
        </svg>'''
        
        svg_path = output_path + '.svg'
        with open(svg_path, 'w') as f:
            f.write(svg_content)
        
        # Try to convert using rsvg-convert or convert (ImageMagick)
        try:
            subprocess.run(['rsvg-convert', '-w', str(size), '-h', str(size), 
                          '-o', output_path, svg_path], check=True)
            os.unlink(svg_path)
            print(f"Created browser icon: {output_path}")
            return
        except:
            pass
            
        try:
            subprocess.run(['convert', '-size', f'{size}x{size}', svg_path, 
                          output_path], check=True)
            os.unlink(svg_path)
            print(f"Created browser icon: {output_path}")
            return
        except:
            pass
            
        os.unlink(svg_path)
    except:
        pass
    
    # Fallback: create simple colored PNG
    create_minimal_png(size, size, (66, 133, 244), output_path)
    print(f"Created fallback icon: {output_path}")

def main():
    """Generate all required icons"""
    assets_dir = os.path.join(os.path.dirname(__file__), 'extension', 'assets')
    os.makedirs(assets_dir, exist_ok=True)
    
    sizes = [16, 48, 128]
    for size in sizes:
        output_path = os.path.join(assets_dir, f'icon{size}.png')
        create_browser_icon(size, output_path)
    
    print("✅ Icons created successfully")

if __name__ == '__main__':
    main()