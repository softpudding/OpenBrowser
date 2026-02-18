#!/usr/bin/env python3
import re

with open('server/agent/agent.py', 'r') as f:
    content = f.read()

# 替换所有 print(f"DEBUG: 为 logger.debug(f"DEBUG:
content = re.sub(r'print\(f"DEBUG:', r'logger.debug(f"DEBUG:', content)

# 替换 traceback.print_exc() 为 logger.error(traceback.format_exc())
content = content.replace('traceback.print_exc()', 'logger.error(traceback.format_exc())')

with open('server/agent/agent.py', 'w') as f:
    f.write(content)

print('替换完成')