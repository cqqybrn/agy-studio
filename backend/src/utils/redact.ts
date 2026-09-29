export function redactSecrets(input: string): string {
  let s = input;
  s = s.replace(/ya29\.[0-9A-Za-z_.-]+/g, '<redacted:access_token>');
  s = s.replace(/1\/\/[0-9A-Za-z_-]+/g, '<redacted:refresh_token>');
  s = s.replace(/GOCSPX-[0-9A-Za-z_-]+/g, '<redacted:client_secret>');
  s = s.replace(/[0-9]+-[0-9a-z_.-]+\.apps\.googleusercontent\.com/gi, '<redacted:client_id>');
  s = s.replace(/Bearer\s+[A-Za-z0-9_.-]+/gi, 'Bearer <redacted:token>');
  s = s.replace(/Authorization:\s*[^\r\n]+/gi, 'Authorization: <redacted>');
  return s;
}
