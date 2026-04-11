#!/usr/bin/env python3
import re

# Read the new stock data
with open("/tmp/stocks_data.js", "r") as f:
    new_stock_data = f.read()

# Read the current finviz.js
with open("js/finviz.js", "r") as f:
    content = f.read()

# Find and replace the STOCKS_DATA array
pattern = r"// Stock data - embedded for frontend operation\nconst STOCKS_DATA = \[[\s\S]*?\];"
replacement = new_stock_data

# Use a simpler approach - find the start and end of STOCKS_DATA
start_marker = "const STOCKS_DATA = ["
end_marker = "let allStocks"

start_idx = content.find(start_marker)
end_idx = content.find(end_marker)

if start_idx == -1 or end_idx == -1:
    print("Could not find STOCKS_DATA markers")
    print(f"Start: {start_idx}, End: {end_idx}")
    exit(1)

# Replace the stock data
new_content = content[:start_idx] + new_stock_data + "\n\n" + content[end_idx:]

# Write back
with open("js/finviz.js", "w") as f:
    f.write(new_content)

print(f"Updated finviz.js with new stock data")
print(f"New file size: {len(new_content)} bytes")
