const cloud = require('wx-server-sdk');
const axios = require('axios');

// 初始化云开发环境
cloud.init();

const qwenApiKey = 'your_key'; // 替换为你的 API Key

const maxRetries = 3;
const timeout = 15000; // 5秒超时

exports.main = async (event, context) => {
  const { message } = event;

  const url = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
  const data = {
    model: "qwen-turbo",
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: message }
    ]
  };

  let retryCount = 0;

  while (retryCount <= maxRetries) {
    try {
      const response = await axios.post(url, data, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${qwenApiKey}`
        },
        timeout: timeout // 设置超时时间为5秒
      });

      if (response.status === 200) {
        const reply = response.data?.choices?.[0]?.message?.content?.trim();
        return {
          success: true,
          reply: reply || 'AI 回复为空'
        };
      } else {
        return {
          success: false,
          error: `请求失败，状态码: ${response.status}`,
          response: response.data
        };
      }
    } catch (error) {
      retryCount++;
      if (retryCount > maxRetries) {
        return {
          success: false,
          error: `请求失败，已达到最大重试次数 (${maxRetries}次)`,
          lastError: error.message
        };
      }
      console.log(`请求失败，正在尝试第${retryCount}次重试...`);
    }
  }
};