function classifyResponse(text) {
    const normalized = text.toLowerCase();
  
    const yesKeywords = ["yes", "yeah", "yep", "sure", "of course", "i agree", "ok", "okay"];
    const noKeywords = ["no","na","naa", "nope", "never", "not really", "i don't"]; 
    const repeatKeywords = ["repeat", "again", "what", "sorry", "can you repeat", "didn't catch"];
  
    if (yesKeywords.some((k) => normalized.includes(k))) return "yes";
    if (noKeywords.some((k) => normalized.includes(k))) return "no";
    if (repeatKeywords.some((k) => normalized.includes(k))) return "repeat";
  
    return "unrecognized";
  }
  
  module.exports = classifyResponse;