import crypto from "node:crypto";

export const normalizeFormat = (format) => {
  if (!format) {
    return "mp3";
  }
  const lower = format.toLowerCase();
  if (lower === "m4a") {
    return "mp4";
  }
  return lower;
};

export const buildSubmitPayload = ({
  audioUrl,
  format,
  language,
  modelVersion,
  enableItn,
  enablePunc,
  enableDdc,
  showUtterances
}) => ({
  user: {
    uid: "feishu_bitable_plugin"
  },
  audio: {
    url: audioUrl,
    format: normalizeFormat(format),
    language: language || undefined
  },
  request: {
    model_name: "bigmodel",
    model_version: modelVersion || undefined,
    enable_itn: enableItn ?? true,
    enable_punc: enablePunc ?? true,
    enable_ddc: enableDdc ?? false,
    show_utterances: showUtterances ?? false
  }
});

export const extractText = (result) => {
  if (!result) {
    return "";
  }
  if (typeof result.text === "string") {
    return result.text;
  }
  if (Array.isArray(result.utterances)) {
    return result.utterances.map((item) => item.text || "").join("");
  }
  return "";
};

export const extractDurationMs = (result) => {
  if (!result) {
    return 0;
  }
  const durationValue = Number(result.duration);
  if (Number.isFinite(durationValue) && durationValue > 0) {
    if (durationValue < 1000) {
      return Math.round(durationValue * 1000);
    }
    return Math.round(durationValue);
  }
  if (Array.isArray(result.utterances)) {
    const maxEnd = result.utterances.reduce((max, item) => {
      const end = Number(item?.end_time);
      if (!Number.isFinite(end)) {
        return max;
      }
      return Math.max(max, end);
    }, 0);
    return maxEnd > 0 ? Math.round(maxEnd) : 0;
  }
  return 0;
};

export const createVolcengineClient = ({ appId, accessKey, resourceId, fetchImpl }) => {
  const fetcher = fetchImpl || fetch;
  const submitUrl = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit";
  const queryUrl = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/query";

  const submitTask = async (payload) => {
    const requestId = crypto.randomUUID();
    const response = await fetcher(submitUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-App-Key": appId,
        "X-Api-Access-Key": accessKey,
        "X-Api-Resource-Id": resourceId,
        "X-Api-Request-Id": requestId,
        "X-Api-Sequence": "-1"
      },
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    const statusCode = response.headers.get("X-Api-Status-Code");
    const logId = response.headers.get("X-Tt-Logid") || "";
    if (!response.ok || statusCode !== "20000000") {
      throw new Error(responseText || `提交失败: ${statusCode || response.status}`);
    }
    return { taskId: requestId, logId, raw: responseText };
  };

  const queryTask = async ({ taskId, logId }) => {
    const response = await fetcher(queryUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-App-Key": appId,
        "X-Api-Access-Key": accessKey,
        "X-Api-Resource-Id": resourceId,
        "X-Api-Request-Id": taskId,
        ...(logId ? { "X-Tt-Logid": logId } : {})
      },
      body: JSON.stringify({})
    });
    const responseJson = await response.json().catch(() => ({}));
    const statusCode = response.headers.get("X-Api-Status-Code");
    const nextLogId = response.headers.get("X-Tt-Logid") || logId || "";
    return { statusCode, logId: nextLogId, result: responseJson };
  };

  return { submitTask, queryTask };
};
