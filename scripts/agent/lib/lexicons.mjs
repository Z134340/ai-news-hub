// 主題詞庫：把每日新聞分派到六個趨勢叢集。
//
// 這六個 cluster_id 不是新發明的，是從 2026-07-09 那批既有 data/agent/trends.json
// 反推回來的（llm_evaluation_governance / developer_tooling_rag /
// model_release_and_inference / agent_engineering / ai_security_and_privacy /
// ai_learning_and_enablement）。刻意沿用同一組 id，讓 07-09 之後的產出跟那批
// 歷史輸出可以直接接續比較，不會因為換名字而斷了時間序列。
//
// 為什麼分派用「程式」而不是「agent」：這裡要的是「一致」不是「判斷」——
// 同一則新聞今天分到 governance、明天分到 security，時間軸圖就會出現假的趨勢波動。
// 詞庫比對是決定論的，逐行可稽核。真正需要判斷的部分（這個趨勢對市場的含意）
// 留給 MarketLens agent，兩者分工不重疊。
//
// financial_base 是「這個主題對金融機構的先天含意」，0~1。它不是猜的，是照風險
// 歸屬的遠近排的：模型治理直接對應模型風險管理與監理說明（0.45）＞資安對應
// 事件通報與個資義務（0.40）＞agent 工程對應自動化作業風險歸屬（0.35）＞
// 模型發布對應選型與成本（0.30）＞開發工具對應生產力投資（0.25）＞
// 教育訓練對應人才成本（0.20）。這組值刻意落在 2026-07-09 那批既有輸出實際觀測到的
// 0.215~0.45 區間內，讓新舊分數可以放在同一條時間軸上比。

export const TOPIC_LEXICONS = [
  {
    cluster_id: "llm_evaluation_governance",
    title: "LLM Evaluation, Safety, and Governance",
    financial_base: 0.45,
    financial_implication:
      "此趨勢直接影響模型風險管理、第三方模型採用、監理說明與內部驗證證據鏈。",
    suggested_action:
      "比對 NIST、OWASP、EU AI Act 與金融業模型風險控制要求，整理可落地檢核項。",
    terms: [
      "governance", "regulation", "regulatory", "compliance", "audit", "policy",
      "nist", "eu ai act", "iso 42001", "benchmark", "evaluation", "eval",
      "llm-as-a-judge", "rubric", "alignment", "safety", "guardrail",
      "hallucination", "red team", "redteam", "transparency", "accountability",
      "治理", "監理", "監管", "法遵", "合規", "稽核", "政策", "法案", "評估",
      "評測", "基準", "對齊", "安全", "風險", "幻覺", "問責", "透明",
    ],
  },
  {
    cluster_id: "developer_tooling_rag",
    title: "Developer Tooling and RAG",
    financial_base: 0.25,
    financial_implication:
      "此趨勢影響內部知識庫檢索品質、文件問答正確率與開發生產力投資的回收期。",
    suggested_action:
      "盤點現有 RAG 管線的切塊、嵌入與重排設定，對照新工具評估替換成本與可量測增益。",
    terms: [
      "rag", "retrieval", "retrieval-augmented", "vector database", "embedding",
      "reranker", "chunking", "knowledge base", "sdk", "cli", "ide", "copilot",
      "developer tool", "framework", "library", "langchain", "llamaindex",
      "mcp", "model context protocol", "ci/cd", "devtool",
      "檢索", "向量", "嵌入", "重排", "切塊", "知識庫", "開發工具", "套件",
      "框架", "外掛", "整合開發",
    ],
  },
  {
    cluster_id: "model_release_and_inference",
    title: "Model Releases and Inference",
    financial_base: 0.3,
    financial_implication:
      "此趨勢影響模型選型、單位推論成本與既有應用的重新測試負擔。",
    suggested_action:
      "更新模型能力/價格對照表，重算主力場景的每千次呼叫成本與延遲門檻。",
    terms: [
      "release", "launch", "gpt", "claude", "gemini", "llama", "qwen", "mistral",
      "deepseek", "grok", "inference", "throughput", "latency", "quantization",
      "quantized", "context window", "token", "pricing", "flagship", "frontier",
      "multimodal", "reasoning model", "distillation", "moe", "checkpoint",
      "發布", "推出", "上線", "開源", "推論", "延遲", "吞吐", "量化", "蒸餾",
      "上下文", "定價", "旗艦", "多模態", "參數量",
    ],
  },
  {
    cluster_id: "agent_engineering",
    title: "Agent Engineering",
    financial_base: 0.35,
    financial_implication:
      "此趨勢影響自動化流程的可控性、人機交接點設計與作業風險的歸屬。",
    suggested_action:
      "檢視現有 agent 的工具權限邊界與人工核可關卡，確認高風險動作不會被自動執行。",
    terms: [
      "agent", "agentic", "autonomous", "multi-agent", "tool use", "tool-use",
      "function calling", "orchestration", "workflow", "planner", "memory",
      "scaffold", "harness", "computer use", "browser agent", "coding agent",
      "代理", "自主", "多代理", "工具呼叫", "編排", "工作流", "記憶", "規劃",
    ],
  },
  {
    cluster_id: "ai_security_and_privacy",
    title: "AI Security and Privacy",
    financial_base: 0.4,
    financial_implication:
      "此趨勢直接對應資安事件通報、個資保護與供應鏈風險的揭露義務。",
    suggested_action:
      "把新出現的攻擊手法對照現行控制項，確認提示注入與資料外洩已有偵測與阻斷。",
    terms: [
      "security", "vulnerability", "cve", "exploit", "attack", "prompt injection",
      "jailbreak", "data leak", "breach", "privacy", "pii", "gdpr", "encryption",
      "supply chain attack", "malware", "phishing", "adversarial", "poisoning",
      "資安", "漏洞", "攻擊", "提示注入", "越獄", "外洩", "個資", "隱私",
      // 刻意不收單獨的「供應鏈」：實測會把「封測產能擴充」這類純產業新聞誤判成資安事件。
      "加密", "供應鏈攻擊", "供應鏈風險", "惡意", "釣魚", "投毒",
    ],
  },
  {
    cluster_id: "ai_learning_and_enablement",
    title: "AI Learning and Enablement",
    financial_base: 0.2,
    financial_implication:
      "此趨勢影響內部人才培育路徑與導入期的教育訓練成本。",
    suggested_action:
      "挑選與現行技術棧相符的教材，排入內部培訓，避免採購重複的外部課程。",
    terms: [
      "course", "tutorial", "guide", "handbook", "workshop", "certification",
      "curriculum", "training", "onboarding", "best practice", "how to",
      "deeplearning.ai", "cookbook", "walkthrough", "primer",
      "課程", "教學", "指南", "手冊", "工作坊", "認證", "培訓", "入門",
      "實作", "教程", "最佳實務",
    ],
  },
];

// 金融相關度詞庫：獨立於主題詞庫，用來算 score_breakdown.financial_relevance。
// 這一項刻意單獨拉出來，因為本站的判斷視角是「這件事對金融業有沒有含意」，
// 而不是「這件事技術上新不新」——同一個 cluster 在不同期間的金融相關度會變。
//
// 這裡刻意「不」收 governance / regulation / compliance / audit / risk / 監理 /
// 法遵 / 稽核 / 風險 這幾個字。它們同時出現在 llm_evaluation_governance 的主題詞庫裡，
// 一旦兩邊共用，任何被分進 governance 叢集的新聞都會自動拿到高金融相關度——
// 那量到的是「它是不是 governance」，不是「它對金融業有沒有含意」，屬於循環論證。
// 第一次試跑就是這樣把金融相關度推到 0.6~0.67（2026-07-09 基準只有 0.215~0.45）。
// 同理也不收「產業」這種寬詞：AI 硬體、半導體新聞會整批被誤標成金融相關。
export const FINANCIAL_LEXICON = [
  "bank", "banking", "financial institution", "finance", "fintech", "insurance",
  "insurer", "securities", "brokerage", "trading", "asset management",
  "basel", "aml", "kyc", "fraud", "credit risk", "underwriting",
  "central bank", "payments", "settlement", "custody",
  "金融", "銀行", "保險", "證券", "券商", "投信", "資產管理", "金管會",
  "央行", "支付", "清算", "信用", "授信", "洗錢", "詐欺", "上市", "併購",
  "營收", "估值", "融資", "投資", "資本適足",
];

// 證據品質：能算進 evidence_quality 的來源類型。
// 一手來源（論文、官方發布、監理機關）給滿分，二手轉述給折扣。
export const HIGH_QUALITY_SOURCE_HINTS = [
  "arxiv", "anthropic", "openai", "google", "deepmind", "meta", "microsoft",
  "nvidia", "nist", "iso", "ieee", "acm", "nature", "science",
  "數位發展部", "國發會", "金管會", "中央社",
];

const norm = (value) => String(value || "").toLowerCase();

// 回傳這則新聞命中的詞（原樣保留，供 evidence.reason 顯示「Matched ...」）。
// 中文詞用子字串比對；英文詞加詞邊界，避免 "sec " 命中 "second"、"eval" 命中 "evaluate"
// 以外的無關字。判斷依據是詞本身有沒有 ASCII 以外的字元。
export function matchTerms(haystack, terms) {
  const hay = norm(haystack);
  const hits = [];
  for (const term of terms) {
    const t = norm(term);
    if (!t) continue;
    const isAscii = /^[\x00-\x7f]+$/.test(t);
    if (isAscii) {
      const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(hay)) hits.push(term);
    } else if (hay.includes(t)) {
      hits.push(term);
    }
  }
  return hits;
}
