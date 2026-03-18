# CloudStack - 阿里云高保真仿真环境

CloudStack 是一个高保真的阿里云官网仿真环境，专为 AI Agent 浏览器自动化测试和挑战性训练而设计。

## 🎯 设计目标

- **1:1 还原阿里云设计**：视觉风格、布局、配色尽可能接近阿里云官网
- **丰富的交互元素**：大量可点击按钮、表单、模态框、下拉菜单
- **挑战性测试环境**：为 AI Agent 提供复杂的浏览器操作场景
- **完整的页面体系**：主页、产品、定价、支持等多个页面

## 📁 文件结构

```
cloudstack/
├── index.html          # 首页
├── products.html       # 产品列表页
├── pricing.html        # 定价页面
├── support.html        # 支持页面
├── console.html        # 控制台页面
├── oss.html            # OSS 产品页
├── rds.html            # RDS 产品页
├── das.html            # DAS 产品页
├── vpc.html            # VPC 产品页
├── slb.html            # SLB 产品页
├── billing.html        # 账单页面
├── security.html       # 安全页面
├── cms.html            # 云监控页面
├── actiontrail.html    # 操作审计页面
├── budget.html         # 预算页面
├── config.html         # 配置审计页面
├── placeholder.html    # 通用占位页面
├── css/
│   └── cloudstack.css  # 主样式文件 (1700+ 行)
├── js/
│   ├── homepage.js     # 首页交互逻辑
│   ├── products.js     # 产品页交互逻辑
│   ├── pricing.js      # 定价页交互逻辑
│   ├── cloudstack.js   # 通用组件逻辑
│   └── das-agent.js    # DAS 代理逻辑
└── images/             # 图片资源
# Note: tracker.js is a shared library located at /js/tracker.js
```

## ✨ 核心功能

### 1. 首页 (index.html)
- **导航栏**：Products 下拉菜单、Solutions、Pricing、Partners、Support、About
- **用户功能**：登录/注册按钮、控制台入口、语言选择、通知中心
- **搜索功能**：产品/文档搜索框
- **营销区域**：AI Innovation Season 横幅、优惠券包、产品卡片
- **产品展示**：Popular Cloud Products 网格
- **模态框**：登录、注册、语言选择、通知面板

### 2. 产品页面 (products.html)
- **产品过滤**：All Products、Compute、Storage、Database、Network、Security、AI & Analytics
- **产品卡片**：24+ 个产品，包含图标、名称、描述、价格
- **交互功能**：类别过滤、产品详情链接
- **产品类别**：
  - Compute: ECS, Auto Scaling, Container Service, Serverless
  - Storage: OSS, File Storage, Block Storage, Archive Storage
  - Database: RDS, Redis, MongoDB, PolarDB
  - Network: VPC, SLB, NAT Gateway, CDN
  - Security: Security Center, WAF, Anti-DDoS, SSL Certificates
  - AI: Machine Learning, NLP, Computer Vision, Speech Recognition

### 3. 定价页面 (pricing.html)
- **定价周期切换**：Hourly / Monthly / Yearly (Save 20%)
- **定价方案**：Free Tier、Pay-As-You-Go、Enterprise
- **产品定价表格**：Compute、Storage、Database、Network 标签页切换
- **价格计算器**：CTA 区域

### 4. 支持页面 (support.html)
- **支持选项**：Documentation、Community、Submit Ticket、Contact Sales
- **FAQ 折叠面板**：常见问题解答
- **联系表单**：姓名、邮箱、主题、消息
- **联系信息**：电话、邮箱、地址

### 5. 控制台页面 (console.html)
- **顶部导航**：控制台专用导航
- **侧边栏**：产品导航菜单
- **主内容区**：资源管理界面
- **功能模块**：ECS 实例、OSS 存储、RDS 数据库等

### 6. 产品详情页 (oss.html, rds.html, das.html, vpc.html, slb.html)
- **产品介绍**：产品特性、优势
- **定价信息**：价格表格、计算器
- **文档链接**：用户指南、API 文档
- **立即使用**：CTA 按钮

## 🎨 交互功能

### 模态框 (Modals)
- ✅ 登录模态框 - 用户名/密码、社交登录、注册链接
- ✅ 注册模态框 - 邮箱、验证码、密码强度指示
- ✅ 语言选择模态框 - 多语言选项
- ✅ 通知面板 - 未读消息列表

### 表单 (Forms)
- ✅ 登录表单 - 输入验证、记住我、忘记密码
- ✅ 注册表单 - 邮箱验证、密码强度、验证码
- ✅ 联系表单 - 姓名、邮箱、主题、消息
- ✅ 搜索表单 - 产品/文档搜索

### 导航 (Navigation)
- ✅ 顶部导航栏 - 多级别下拉菜单
- ✅ 移动端汉堡菜单 - 响应式设计
- ✅ 面包屑导航 - 页面层级显示
- ✅ 标签页切换 - 定价表格、产品过滤

### 动态效果 (Animations)
- ✅ Hover 效果 - 按钮、卡片、链接
- ✅ 模态框动画 - fadeIn、scaleIn
- ✅ 过渡效果 - color、background、transform
- ✅ 加载动画 - spinner、progress bar

## 🔧 技术栈

- **HTML5**：语义化标签、无障碍访问
- **CSS3**：Flexbox、Grid、动画、响应式设计
- **JavaScript**：原生 JS、无依赖
- **设计系统**：阿里云设计语言（橙色主题色 #FF6A00）

## 🎯 测试场景

CloudStack 为 AI Agent 提供以下挑战性测试场景：

1. **表单填写**：登录、注册、联系表单
2. **导航操作**：下拉菜单、标签页切换、页面跳转
3. **模态框处理**：打开、关闭、表单提交
4. **内容过滤**：产品类别筛选、定价周期切换
5. **滚动操作**：长页面滚动、内容加载
6. **元素查找**：在复杂页面中定位特定元素
7. **多页面操作**：跨页面导航、状态保持

## 🚀 本地运行

```bash
# 启动本地服务器（端口 16605）
python -m http.server 16605 --directory cloudstack/

# 或使用 Node.js
npx http-server cloudstack/ -p 16605
```

访问：http://localhost:16605/cloudstack/

## 📊 页面统计

| 页面 | 行数 | 功能点 |
|------|------|--------|
| index.html | 338+ | 导航、模态框、产品展示 |
| products.html | 280+ | 过滤、产品卡片 |
| pricing.html | 350+ | 定价切换、表格 |
| support.html | 250+ | FAQ、联系表单 |
| console.html | 400+ | 控制台界面 |
| cloudstack.css | 1700+ | 完整样式系统 |
| homepage.js | 400+ | 交互逻辑 |

## 🎨 设计参考

- **主色调**：橙色 #FF6A00（阿里云品牌色）
- **渐变**：紫色系 #667eea → #764ba2
- **字体**：系统字体栈，优先使用 -apple-system
- **间距**：8px 基准网格系统
- **圆角**：8px-12px 现代圆角

## 📝 待扩展页面

以下页面已链接但尚未完全实现，可作为未来扩展：

- solutions.html - 解决方案页面
- marketplace.html - 云市场
- partners.html - 合作伙伴
- about.html - 关于我们
- careers.html - 加入我们
- contact.html - 联系我们
- privacy.html - 隐私政策
- terms.html - 服务条款

## 🤝 贡献指南

欢迎贡献更多功能和页面！请确保：

1. 保持与阿里云设计风格一致
2. 添加充分的交互元素
3. 确保响应式设计
4. 遵循现有代码规范

## 📄 许可证

本项目用于 AI Agent 浏览器自动化测试和研究目的。
