# UPI Fraud Detection — Dataset Audit

_Generated: 2026-10-02T13:04:48+00:00_

## PaySim (Transaction Dataset)

- **Provenance**: PaySim public mobile-money transaction simulator
- **Disclaimer**: PaySim is a PUBLIC MOBILE-MONEY SIMULATOR dataset. It is NOT real UPI banking data and does not establish a causal transaction-message relationship.

| Split | Rows | Fraud | Legitimate | Fraud Rate | Step Range |
|---|---|---|---|---|---|
| train | 613340 | 5781 | 607559 | 0.9425% | 1-520 |
| validation | 20214 | 1180 | 19034 | 5.8375% | 521-631 |
| test | 10099 | 1252 | 8847 | 12.3973% | 632-743 |

### Amount statistics (train split)

count=613,340  mean=191466.06  median=76896.83  std=655984.64  min=0.00  max=92445516.64

### Type distribution (train split)

- `CASH_IN`: 133,648
- `CASH_OUT`: 217,501
- `DEBIT`: 3,995
- `PAYMENT`: 204,812
- `TRANSFER`: 53,384

### Temporal pattern — fraud rate per 10-step window (train)

| step_window | transactions | fraud_count | fraud_rate | mean_amount |
|---|---|---|---|---|
| 0 | 7,319 | 109 | 1.4893% | 174678.23 |
| 10 | 42,086 | 122 | 0.2899% | 172042.31 |
| 20 | 8,561 | 86 | 1.0046% | 400432.27 |
| 30 | 21,246 | 141 | 0.6637% | 324634.19 |
| 40 | 24,292 | 126 | 0.5187% | 132339.67 |
| 50 | 118 | 118 | 100.0000% | 1118742.29 |
| 60 | 148 | 148 | 100.0000% | 980700.85 |
| 70 | 112 | 112 | 100.0000% | 1443080.26 |
| 80 | 110 | 110 | 100.0000% | 1800473.07 |
| 90 | 2,994 | 112 | 3.7408% | 560091.11 |
| 100 | 118 | 118 | 100.0000% | 798006.51 |
| 110 | 637 | 90 | 14.1287% | 1060749.99 |
| 120 | 2,782 | 94 | 3.3789% | 1580996.65 |
| 130 | 34,228 | 90 | 0.2629% | 179505.36 |
| 140 | 7,876 | 120 | 1.5236% | 459670.06 |
| 150 | 19,369 | 118 | 0.6092% | 371974.87 |
| 160 | 22,922 | 100 | 0.4363% | 142356.12 |
| 170 | 7,685 | 122 | 1.5875% | 727845.08 |
| 180 | 34,697 | 116 | 0.3343% | 155679.66 |
| 190 | 2,891 | 94 | 3.2515% | 717842.27 |
| 200 | 27,590 | 93 | 0.3371% | 458862.56 |
| 210 | 14,570 | 136 | 0.9334% | 386773.15 |
| 220 | 13,646 | 104 | 0.7621% | 672394.94 |
| 230 | 25,070 | 126 | 0.5026% | 154462.63 |
| 240 | 3,142 | 114 | 3.6283% | 949552.83 |
_(truncated to first 25 windows for readability)_

## Hindi (Message Dataset)

- **Provenance**: Synthetic Hindi SMS dataset (Hinglish-transliterated counterpart exists)
- **Disclaimer**: Hindi/Hinglish CSVs are marked source=Synthetic. They are NOT real-world collected banking messages.
- **Rows**: 10,000
- **Columns**: id, text, language, category, label, source
- **Missing values**: 0
- **Exact duplicates**: 9979
- **Normalized duplicates**: 9979
- **Label distribution**: 0 (legit)=5000, 1 (scam)=5000
- **Category distribution**:
  - `Legitimate`: 5000
  - `Electricity_Scam`: 853
  - `UPI_Scam`: 853
  - `OTP_Scam`: 852
  - `KYC_Scam`: 835
  - `Refund_Scam`: 825
  - `Fake_Customer_Care`: 782
- **Language distribution**:
  - `Hindi`: 10000

## Hinglish (Message Dataset)

- **Provenance**: Synthetic Hinglish SMS dataset (transliterated)
- **Disclaimer**: Marked source=Synthetic — not real-world collected data.
- **Rows**: 10,000
- **Columns**: id, text, language, category, label, source
- **Missing values**: 0
- **Exact duplicates**: 9980
- **Normalized duplicates**: 9980
- **Label distribution**: 0 (legit)=5000, 1 (scam)=5000
- **Category distribution**:
  - `Legitimate`: 5000
  - `Refund_Scam`: 864
  - `Fake_Customer_Care`: 850
  - `UPI_Scam`: 827
  - `KYC_Scam`: 825
  - `Electricity_Scam`: 822
  - `OTP_Scam`: 812
- **Language distribution**:
  - `Hinglish`: 10000

## English (Message Dataset)

- **Provenance**: UCI SMS Spam Collection v1 (public) — downloaded by train.py
- **Disclaimer**: Public dataset, not collected by us. The original `sms spam collection.zip` was not in the user upload; train.py downloads it from the UCI archive at training time. If download is blocked by the sandbox, English falls back to 'not_trained' and no English data is fabricated.
- **Rows**: 5,574
- **Columns**: text, language, category, label, source
- **Missing values**: 0
- **Exact duplicates**: 414
- **Normalized duplicates**: 444
- **Label distribution**: 0 (legit)=4827, 1 (scam)=747
- **Category distribution**:
  - `ham`: 4827
  - `spam`: 747
- **Language distribution**:
  - `English`: 5574

---

_Research prototype — not for production use._