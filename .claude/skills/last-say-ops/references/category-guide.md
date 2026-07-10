# Category And Confidence Guide

Use one of these 14 primary categories exactly:

`飲食`, `日常開銷`, `居住`, `交通`, `購物`, `休閒娛樂`, `訂閱服務`, `醫療保健`, `保險`, `教育學習`, `金融手續與稅費`, `轉帳/內部移轉`, `薪資收入`, `其他收入與收益`.

Use `category_sub` for useful detail, not a new primary category. Common boundaries:

- Prepared meals, cafes, delivery, and convenience-store food -> `飲食`.
- Groceries, household consumables, utilities, and unclear daily necessities -> `日常開銷`.
- Rent, property charges, and housing maintenance -> `居住`.
- Public transport, taxi, fuel, parking, and travel transport -> `交通`.
- Durable goods, apparel, electronics, and non-routine retail -> `購物`.
- Games, events, recreation, and leisure travel experiences -> `休閒娛樂`.
- Recurring software, cloud, media, and memberships -> `訂閱服務`.
- Medical treatment, pharmacy, and health services -> `醫療保健`.
- Insurance premiums -> `保險`.
- Courses, books, training, and learning services -> `教育學習`.
- Bank fees, taxes, and financial service charges -> `金融手續與稅費`.
- Own-account transfers and card payments -> `轉帳/內部移轉`; these are not consumption.

## Confidence

- `0.90-1.00`: identity and use are explicit or supported by authoritative evidence.
- `0.70-0.89`: strong merchant evidence and category fit, with minor ambiguity.
- `0.50-0.69`: plausible best judgment but incomplete merchant or usage evidence.
- `0.20-0.49`: truncated or ambiguous; preserve as low-confidence review work.

Every AI-classified row needs a one-sentence human-readable reason. Search truncated or unfamiliar merchants using `search-playbook.md`. Do not inflate confidence merely to create a rule, and never create a rule below `0.6`.

Before search, retrieve prior evidence as required by `learning-loop.md`. Treat the API's `confidence_ceiling` as the maximum justified by history alone. A similarity score is not confidence. Conflicting history stays below `0.6` unless authoritative new evidence resolves the conflict.
