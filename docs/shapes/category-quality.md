# AH-02 分類品質與可靠前版 shape

權威契約：`docs/specs/category-quality.md`；共用項目契約：`data-contract-v2.md`。

| 入口 | 責任 |
|---|---|
| `scripts/category-quality-policy.json` | 十二分類明列品質門檻、來源日期時窗、理由；不讀 learning-loop canaries |
| `scripts/contracts/category_quality.py` | `decide` 純函式：逐類品質、LKG 重驗、結果／時戳、不生成內容；`reliable`、`eligible` |
| `scripts/category-publication.py` | `collect` 保存 raw bytes／來源；`validate_candidate` 逐類重用 AH-01 validator；`publish` 私有不可變世代／原子 pointer／基準綁定冪等重跑；output 僅候選 |
| `scripts/validate.py` | 原件 index 在 schema pruning／去重後仍保留；legacy 永不計 verified；日期政策共讀 |
| `scripts/merge-stack.py` | daily 使用可注入 now 的 `merge_category` 純函式；只傳入品質合格候選與已核實 LKG。獨立舊 CLI 仍不是發布入口 |
| `scripts/extract-json.py --strict` | 成功空陣列與 parse／transport failure 分開；不修補或生成內容 |
| `scripts/run-daily.sh` | durable candidate capture → category publication → public latest；分類檔不再在擷取時覆寫；health 依逐類決策 |
| `scripts/supplement-run.sh` | 轉交 daily `--categories`，共用鎖／品質／Git，消除繞過入口 |
| `assets/js/data.js` | 有 `_update_outcome` 時信任 selected latest，不以舊 skills.json 蓋回；舊快照相容 |
| `schemas/data/v2/latest.schema.json` | 新增 `_checked_at` 時間與 `_update_outcome` 雙維度 enum；不變更 itemKey |
| `scripts/tests/test_category_quality.py`、`scripts/tests/fixtures/category-quality/mixed-batch.json` | 全分類／同批 updated＋failed＋no_change／損壞／時間／隔離／寫入故障／重跑／daily 安裝 seam，所有寫入使用暫存 fixture |

檔案位置與結果語意只在上述 spec 維護。這是 local quality store，不是 AH-03 release manifest；public deployment／Firebase 未在本工項操作。
