# 使用 Node.js 官方轻量级镜像
FROM node:18-alpine

# 设置工作目录
WORKDIR /app

# 复制 package.json 和 package-lock.json (如果有)
COPY package.json ./

# 安装依赖
RUN npm install

# 复制所有源代码
COPY . .

# 构建前端资源
RUN npm run build

# 暴露端口 (默认 Express 端口)
EXPOSE 5174

# 设置环境变量为生产模式
ENV NODE_ENV=production
ENV PORT=5174

# 启动服务
CMD ["npm", "run", "start"]
