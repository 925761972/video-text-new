const env = process.env.NODE_ENV || "development";

export const allowAdmin = (req) => {
  const token = process.env.ADMIN_TOKEN || "";
  if (token) {
    return req.get("x-admin-token") === token;
  }
  return env !== "production";
};
