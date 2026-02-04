import { bitable, FieldType } from "@lark-base-open/js-sdk";
import "./style.css";

const attachmentSelect = document.getElementById("attachmentField");
const outputSelect = document.getElementById("outputField");
const languageSelect = document.getElementById("language");
const modelVersionSelect = document.getElementById("modelVersion");
const enableItnToggle = document.getElementById("enableItn");
const enablePuncToggle = document.getElementById("enablePunc");
const enableDdcToggle = document.getElementById("enableDdc");
const showUtterancesToggle = document.getElementById("showUtterances");
const skipExistingOutputToggle = document.getElementById("skipExistingOutput");
const runButton = document.getElementById("runButton");
const stopButton = document.getElementById("stopButton");
const statusEl = document.getElementById("status");
const progressEl = document.getElementById("progress");
const tabButtons = document.querySelectorAll("[data-page-target]");
const pages = document.querySelectorAll(".page");
const subscriptionStatusEl = document.getElementById("subscriptionStatus");
const subscriptionDetailEl = document.getElementById("subscriptionDetail");
const trialRemainingEl = document.getElementById("trialRemaining");
const tenantBaseIdEl = document.getElementById("tenantBaseId");
const planListEl = document.getElementById("planList");
const modelUnitPriceEl = document.getElementById("modelUnitPrice");
const modelUsageDailyMinutesEl = document.getElementById("modelUsageDailyMinutes");
const modelUsageDailyCostEl = document.getElementById("modelUsageDailyCost");
const modelUsageCountEl = document.getElementById("modelUsageCount");
const modelUsageCostEl = document.getElementById("modelUsageCost");

const state = {
  table: null,
  attachmentFields: [],
  textFields: [],
  baseId: ""
};

let shouldStop = false;

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const defaultFormats = ["mp3", "mp4", "wav", "m4a", "flac", "ogg", "aac", "mov", "avi", "wmv", "wma", "webm", "amr", "mkv", "3gp"];
const allowedFormats = new Set(
  (import.meta.env?.VITE_ALLOWED_FORMATS || defaultFormats.join(","))
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
);
const maxAttachmentSizeMb = Number(import.meta.env?.VITE_MAX_ATTACHMENT_MB || "200");
const maxAttachmentSizeBytes =
  Number.isFinite(maxAttachmentSizeMb) && maxAttachmentSizeMb > 0 ? maxAttachmentSizeMb * 1024 * 1024 : 200 * 1024 * 1024;
const concurrencyLimit = Math.min(parsePositiveInt(import.meta.env?.VITE_CONCURRENCY || "3", 3), 50);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const setStatus = (text) => {
  statusEl.textContent = text;
};

const pushProgress = (line) => {
  progressEl.textContent = `${progressEl.textContent}\n${line}`.trim();
};

const clearProgress = () => {
  progressEl.textContent = "";
};

const setActivePage = (target) => {
  tabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.pageTarget === target);
  });
  pages.forEach((page) => {
    page.classList.toggle("hidden", page.dataset.page !== target);
  });
};

const createOption = (field) => {
  const option = document.createElement("option");
  option.value = field.id;
  option.textContent = field.name;
  return option;
};

const parseErrorMessage = async (response) => {
  const text = await response.text();
  if (!text) {
    return "请求失败";
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed?.message) {
      return parsed.message;
    }
  } catch {}
  return text;
};

const postJson = async (url, payload) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const message = await parseErrorMessage(response);
    throw new Error(message);
  }
  return response.json();
};

const getJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    const message = await parseErrorMessage(response);
    throw new Error(message);
  }
  return response.json();
};

const formatPlanPrice = (plan) => {
  const price = Number(plan.price);
  const priceText = Number.isFinite(price) ? `${price}` : "-";
  return `${priceText}元/${plan.label}`;
};

const renderPlanList = (plans = []) => {
  planListEl.innerHTML = "";
  if (!plans.length) {
    planListEl.textContent = "暂未配置订阅方案";
    return;
  }
  plans.forEach((plan) => {
    const card = document.createElement("div");
    card.className = "plan-card";

    const info = document.createElement("div");
    info.className = "plan-info";

    const title = document.createElement("div");
    title.className = "plan-title";
    title.textContent = `${plan.label}套餐`;

    const note = document.createElement("div");
    note.className = "plan-note";
    note.textContent = formatPlanPrice(plan);

    info.appendChild(title);
    info.appendChild(note);

    const action = document.createElement("button");
    action.type = "button";
    action.className = "plan-action";
    action.textContent = "立即开通";
    action.addEventListener("click", async () => {
      if (!state.baseId) {
        subscriptionDetailEl.textContent = "缺少 baseId";
        return;
      }
      action.disabled = true;
      try {
        const result = await postJson("/api/billing/checkout", {
          baseId: state.baseId,
          planId: plan.id
        });
        if (result.payUrl) {
          window.open(result.payUrl, "_blank");
          subscriptionDetailEl.textContent = "已生成支付链接，请完成支付后刷新订阅状态";
        } else {
          subscriptionDetailEl.textContent = "暂未配置支付链接，请联系服务方";
        }
      } catch (error) {
        subscriptionDetailEl.textContent = error.message || "创建订单失败";
      } finally {
        action.disabled = false;
      }
    });

    card.appendChild(info);
    card.appendChild(action);
    planListEl.appendChild(card);
  });
};

const fetchPlans = async () => {
  const query = state.baseId ? `?baseId=${encodeURIComponent(state.baseId)}` : "";
  try {
    const plans = await getJson(`/api/billing/plans${query}`);
    renderPlanList(plans);
  } catch (error) {
    planListEl.textContent = error.message || "获取订阅方案失败";
  }
};

const renderSubscriptionStatus = (status) => {
  if (!status) {
    subscriptionStatusEl.textContent = "未获取到订阅状态";
    subscriptionDetailEl.textContent = "";
    trialRemainingEl.textContent = "-";
    tenantBaseIdEl.textContent = "-";
    modelUnitPriceEl.textContent = "-";
    modelUsageDailyMinutesEl.textContent = "-";
    modelUsageDailyCostEl.textContent = "-";
    modelUsageCountEl.textContent = "-";
    modelUsageCostEl.textContent = "-";
    return;
  }
  subscriptionStatusEl.textContent = status.isPaid ? "已开通" : "试用中";
  subscriptionDetailEl.textContent = status.message || "";
  trialRemainingEl.textContent = Number.isFinite(status.freeRemaining) ? `${status.freeRemaining}` : "-";
  tenantBaseIdEl.textContent = status.baseId || "-";
};

const renderUsage = (usage) => {
  if (!usage) {
    modelUnitPriceEl.textContent = "-";
    modelUsageDailyMinutesEl.textContent = "-";
    modelUsageDailyCostEl.textContent = "-";
    modelUsageCountEl.textContent = "-";
    modelUsageCostEl.textContent = "-";
    return;
  }
  modelUnitPriceEl.textContent = "0.0018元/秒";
  modelUsageDailyMinutesEl.textContent = Number.isFinite(usage.dailyMinutes) ? `${usage.dailyMinutes}` : "-";
  modelUsageDailyCostEl.textContent = Number.isFinite(usage.dailyCost) ? `${usage.dailyCost}` : "-";
  modelUsageCountEl.textContent = Number.isFinite(usage.minutes ?? usage.count) ? `${usage.minutes ?? usage.count}` : "-";
  modelUsageCostEl.textContent = Number.isFinite(usage.cost) ? `${usage.cost}` : "-";
};

const fetchSubscriptionStatus = async () => {
  if (!state.baseId) {
    renderSubscriptionStatus({ baseId: "", isPaid: false, freeRemaining: 0, allowed: false, message: "缺少 baseId" });
    return;
  }
  try {
    const status = await postJson("/api/subscription/status", { baseId: state.baseId });
    renderSubscriptionStatus(status);
  } catch (error) {
    renderSubscriptionStatus({
      baseId: state.baseId,
      isPaid: false,
      freeRemaining: 0,
      allowed: false,
      message: error.message || "获取订阅状态失败"
    });
  }
};

const consumeSubscription = async () => {
  if (!state.baseId) {
    return { allowed: false, message: "缺少 baseId" };
  }
  const status = await postJson("/api/subscription/consume", { baseId: state.baseId });
  renderSubscriptionStatus(status);
  return status;
};

const fetchUsage = async () => {
  if (!state.baseId) {
    renderUsage(null);
    return;
  }
  try {
    const usage = await postJson("/api/billing/usage", { baseId: state.baseId });
    renderUsage(usage);
  } catch {
    renderUsage(null);
  }
};

const refreshFields = async () => {
  const selection = await bitable.base.getSelection();
  const table =
    (selection.tableId && (await bitable.base.getTableById(selection.tableId))) ||
    (await bitable.base.getActiveTable());
  state.table = table;
  state.baseId = selection.baseId || "";

  const fieldMetaList = await table.getFieldMetaList();
  state.attachmentFields = fieldMetaList.filter((field) => field.type === FieldType.Attachment);
  state.textFields = fieldMetaList.filter((field) => field.type === FieldType.Text);

  attachmentSelect.innerHTML = "";
  outputSelect.innerHTML = "";

  state.attachmentFields.forEach((field) => attachmentSelect.appendChild(createOption(field)));
  state.textFields.forEach((field) => outputSelect.appendChild(createOption(field)));

  if (state.attachmentFields.length === 0) {
    setStatus("未找到附件字段");
  } else if (state.textFields.length === 0) {
    setStatus("未找到文本字段");
  } else {
    setStatus("就绪");
  }

  await fetchSubscriptionStatus();
  await fetchPlans();
  await fetchUsage();
};

const getFileExtension = (name = "") => {
  const parts = name.split(".");
  if (parts.length < 2) {
    return "";
  }
  return parts.pop().toLowerCase();
};

const validateAttachment = (file) => {
  if (!file) {
    return { ok: false, reason: "附件为空" };
  }
  const name = file.name || "";
  const extension = getFileExtension(name);
  if (!extension || !allowedFormats.has(extension)) {
    return { ok: false, reason: `不支持的格式: ${name || "未知文件"}` };
  }
  const size = Number(file.size);
  if (Number.isFinite(size) && size > maxAttachmentSizeBytes) {
    return { ok: false, reason: `文件过大: ${name || "未知文件"}` };
  }
  return { ok: true, extension };
};

const normalizeDurationMs = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  if (parsed < 1000) {
    return Math.round(parsed * 1000);
  }
  return Math.round(parsed);
};

const getAttachmentDurationMs = (file) => {
  if (!file) {
    return 0;
  }
  return normalizeDurationMs(
    file.duration ??
      file.durationMs ??
      file.media?.duration ??
      file.media?.durationMs ??
      file.extra?.duration ??
      file.extra?.durationMs
  );
};

const hasExistingOutput = async (record, outputFieldId) => {
  const cell = await record.getCellByField(outputFieldId);
  const value = await cell.getValue();
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return String(value).trim().length > 0;
};

const runWithConcurrency = async (tasks, limit) => {
  if (!tasks.length) {
    return;
  }
  const workerCount = Math.min(Math.max(limit, 1), tasks.length);
  let nextIndex = 0;
  const runWorker = async () => {
    while (true) {
      if (shouldStop) break;
      const current = nextIndex;
      nextIndex += 1;
      if (current >= tasks.length) {
        break;
      }
      await tasks[current]();
    }
  };
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
};

const submitTranscribe = async (payload) => {
  return postJson("/api/transcribe/submit", payload);
};

const queryTranscribe = async (payload) => {
  return postJson("/api/transcribe/query", payload);
};

const transcribeWithPolling = async (payload) => {
  const submitResult = await submitTranscribe(payload);
  const { taskId, logId } = submitResult;
  if (!taskId) {
    throw new Error("未返回任务 ID");
  }
  let currentLogId = logId;

  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (shouldStop) throw new Error("用户停止");
    await wait(2000);
    const queryResult = await queryTranscribe({ taskId, logId: currentLogId, baseId: payload.baseId });
    if (queryResult.logId) {
      currentLogId = queryResult.logId;
    }
    if (queryResult.status === "done") {
      return queryResult.text || "";
    }
    if (queryResult.status === "failed") {
      throw new Error(queryResult.message || "识别失败");
    }
  }
  throw new Error("识别超时");
};

const transcribeWithRetry = async (payload, retries = 5) => {
  let lastError;
  for (let i = 0; i <= retries; i += 1) {
    if (shouldStop) throw new Error("用户停止");
    try {
      return await transcribeWithPolling(payload);
    } catch (error) {
      lastError = error;
      // 如果是“用户停止”错误，直接抛出，不重试
      if (error.message === "用户停止") throw error;
      
      // 检查是否是 QPS 超限错误
      const isQpsError = error.message?.includes("45000292") || error.message?.includes("quota exceeded");
      
      // 最后一次尝试失败，抛出错误
      if (i === retries) break;
      
      const retryWaitMs = isQpsError ? 2000 * (i + 1) : 1000 * (i + 1);
      console.warn(`第 ${i + 1} 次尝试失败，${isQpsError ? "QPS超限，" : ""}准备重试:`, error.message);
      
      // 等待一段时间后重试，递增等待时间
      await wait(retryWaitMs);
    }
  }
  throw lastError;
};

const run = async () => {
  if (!state.table) {
    return;
  }
  if (!attachmentSelect.value || !outputSelect.value) {
    setStatus("请先选择字段");
    return;
  }

  const subscriptionResult = await consumeSubscription();
  if (!subscriptionResult.allowed) {
    setStatus(subscriptionResult.message || "请先开通订阅");
    return;
  }

  shouldStop = false;
  runButton.disabled = true;
  stopButton.disabled = false;
  clearProgress();
  setStatus("处理中");

  try {
    const attachmentFieldId = attachmentSelect.value;
    const outputFieldId = outputSelect.value;
    
    // 使用 getRecords 批量获取数据，避免 getRecordById 可能的报错
    const { records } = await state.table.getRecords({
      pageSize: 5000, // 假设一次性能拿完，如果超过需要分页，但这里先简化
      fieldIdList: [attachmentFieldId, outputFieldId] // 仅获取相关字段，提升速度
    });

    let handled = 0;
    let processedRecords = 0;
    
    // 1. 快速筛选出真正需要处理的记录
    const pendingRecords = [];
    
    // 如果不需要跳过已有内容，那么所有记录都是 pending
    // 如果需要跳过，则先同步检查一遍
    if (!skipExistingOutputToggle?.checked) {
      pendingRecords.push(...records);
    } else {
      // 快速同步检查
      for (const record of records) {
        const recordId = record.recordId;
        const recordFields = record.fields || {};
        const outputValue = recordFields[outputFieldId];
        
        let exists = false;
        if (outputValue !== null && outputValue !== undefined) {
           if (typeof outputValue === "string") {
             exists = outputValue.trim().length > 0;
           } else if (Array.isArray(outputValue)) {
             const allText = outputValue
               .map(item => (item && typeof item === 'object' && item.text) ? String(item.text) : '')
               .join('');
             exists = allText.trim().length > 0;
           } else {
             exists = String(outputValue).trim().length > 0;
           }
        }
        
        if (exists) {
          processedRecords += 1;
        } else {
          pendingRecords.push(record);
        }
      }
      // 更新状态
      setStatus(`已跳过 ${processedRecords} 条，剩余 ${pendingRecords.length} 条待处理`);
    }

    const totalRecords = records.length; // 总数保持不变
    
    // 2. 只为需要处理的记录创建任务
    const tasks = pendingRecords.map((record) => async () => {
      const recordId = record.recordId;
      try {
        if (!record) {
          processedRecords += 1;
          setStatus(`处理中 ${processedRecords}/${totalRecords}`);
          return;
        }

        const recordFields = record.fields || {};
        // 这里再次检查 skip 逻辑其实是多余的，因为上面已经过滤了。
        // 但为了代码结构的完整性，或者防止 toggles 变动（虽然运行中不应变动），保留也无妨。
        // 不过为了极致速度，这里可以直接去掉 skip 检查逻辑。
        
        const attachmentValue = recordFields[attachmentFieldId];
        if (!attachmentValue || attachmentValue.length === 0) {
          processedRecords += 1;
          setStatus(`处理中 ${processedRecords}/${totalRecords}`);
          return;
        }

        const texts = [];
        const files = Array.isArray(attachmentValue) ? attachmentValue : [attachmentValue];
        
        for (const file of files) {
          const fileName = file?.name || "";
          const fileToken = file?.token;
          if (!fileToken) {
            continue;
          }
          const validation = validateAttachment(file);
          if (!validation.ok) {
            pushProgress(`失败: ${fileName || recordId} - ${validation.reason}`);
            continue;
          }
          const durationMs = getAttachmentDurationMs(file);
          const attachmentUrl = await state.table.getAttachmentUrl(fileToken);
          try {
            const text = await transcribeWithRetry({
              audioUrl: attachmentUrl,
              format: validation.extension,
              baseId: state.baseId,
              language: languageSelect.value,
              modelVersion: modelVersionSelect.value,
              enableItn: enableItnToggle.checked,
              enablePunc: enablePuncToggle.checked,
              enableDdc: enableDdcToggle.checked,
              showUtterances: showUtterancesToggle.checked,
              durationMs: durationMs > 0 ? durationMs : undefined
            });
            texts.push(text);
            handled += 1;
            pushProgress(`完成: ${fileName || recordId}`);
          } catch (error) {
            pushProgress(`失败: ${fileName || recordId} - ${error.message}`);
          }
        }
        if (texts.length > 0) {
          await state.table.setCellValue(outputFieldId, recordId, texts.join("\n\n"));
        }
        processedRecords += 1;
        setStatus(`处理中 ${processedRecords}/${totalRecords}`);
      } catch (error) {
        console.error(`处理记录失败: ${recordId}`, error);
        pushProgress(`出错: ${recordId} - ${error.message || "未知错误"}`);
        processedRecords += 1;
        setStatus(`处理中 ${processedRecords}/${totalRecords}`);
      }
    });

    await runWithConcurrency(tasks, concurrencyLimit);

    setStatus(`完成 ${handled} 个附件`);
    await fetchUsage();
  } catch (error) {
    setStatus(error.message || "处理失败");
  } finally {
    runButton.disabled = false;
    stopButton.disabled = true;
  }
};

stopButton.addEventListener("click", () => {
  shouldStop = true;
  stopButton.disabled = true;
  setStatus("正在停止...");
});

runButton.addEventListener("click", run);
tabButtons.forEach((button) => {
  button.addEventListener("click", () => setActivePage(button.dataset.pageTarget));
});

refreshFields();
setActivePage("transcribe");

// 启用协议链接
const termsLink = document.getElementById("termsLink");
if (termsLink) {
  termsLink.href = "./terms.html";
  termsLink.classList.remove("hidden");
}

const privacyLink = document.getElementById("privacyLink");
if (privacyLink) {
  privacyLink.href = "./privacy.html";
  privacyLink.classList.remove("hidden");
}
