import "dotenv/config";
import { createVolcengineClient, buildSubmitPayload } from "./volcengineClient.js";

const formats = ["mp3", "mp4", "wav", "m4a", "flac", "ogg", "aac", "mov", "avi", "wmv", "wma", "webm", "amr", "mkv", "3gp"];
const audioUrl = "https://lf3-static.bytednsdoc.com/obj/eden-cn/5765eh7nuhwe/ASR/test_audio/test_audio_16k.mp3"; // 这是一个公开的测试音频

// 模拟配置 (使用假数据进行请求结构测试，或真实数据进行 E2E 测试)
// 如果想进行真实测试，需要有效的 VOLC_APP_ID 和 VOLC_ACCESS_KEY
const config = {
  appId: process.env.VOLC_APP_ID || "test-app-id",
  accessKey: process.env.VOLC_ACCESS_KEY || "test-access-key",
  resourceId: "volc.bigasr.auc"
};

const client = createVolcengineClient(config);

const runTest = async () => {
  console.log("开始格式兼容性测试...");
  console.log("使用测试音频:", audioUrl);
  
  const results = [];

  for (const format of formats) {
    console.log(`\n测试格式: ${format}`);
    const payload = buildSubmitPayload({
      audioUrl,
      format,
      language: "zh-CN",
    });

    try {
      const result = await client.submitTask(payload);
      console.log(`✅ [${format}] 提交成功 (taskId: ${result.taskId})`);
      results.push({ format, status: "SUCCESS" });
    } catch (error) {
      console.log(`❌ [${format}] 提交失败: ${error.message}`);
      // 检查错误信息是否包含“不支持的格式”
      if (error.message.includes("unsupported") || error.message.includes("format") || error.message.includes("400")) {
         results.push({ format, status: "FAILED", reason: "Format unsupported by API" });
      } else {
         results.push({ format, status: "ERROR", reason: error.message });
      }
    }
  }

  console.log("\n--- 测试总结 ---");
  console.table(results);
};

runTest();
