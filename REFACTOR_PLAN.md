# リファクタリング計画

作成日: 2026-06-03

---

## 背景・目的

コードベース全体のコーティング状況を調査した結果、スクレイパー間や通知機能内に複数の重複コードが見つかった。また、機能追加が続いた `cli.py` が肥大化しており、関心の異なる処理が1ファイルに混在していることも確認された。
このドキュメントでは各候補について、問題の理由・実施した場合のメリット・修正方針を整理し、優先度付きの対応計画をまとめる。

---

## 全体サマリ

### 重複コードの共通化

| 優先度 | # | 候補 | 対象ファイル数 | 重複箇所数 |
|--------|---|------|-------------|----------|
| 高 | 1 | 日付ヘルパーメソッドの共通化 | 2 | 2 |
| 高 | 2 | `result` 辞書初期化の共通化 | 4 | 4 |
| 中 | 3 | Discord truncation の共通化 | 1 | 3 |
| 中 | 4 | `user_agent` 取得の共通化 | 3 | 4 |
| 低 | 5 | 例外処理パターンの共通化 | 4 | 4 |
| 低 | 6 | `_WAIT_MS` 定数の設定化 | 2 | 2 |
| 見送り | 7 | `_parse_machine_lines()` 骨格の共通化 | 2 | 2 |
| 見送り | 8 | `severity_icon` / `level_icon` の統合 | 1 | 2 |
| 見送り | 9 | MB換算ロジックの共通化 | 2 | 2 |

### ファイル分割による保守性向上

| 優先度 | # | 候補 | 現行行数 | 分割後の構成 |
|--------|---|------|---------|------------|
| 高 | 10 | `cli.py` の責務分割 | 1,189行 | `cli.py` + `collector.py` + `commands/` |

---

## 優先度: 高

---

### 候補 1: 日付ヘルパーメソッドを `BaseScraper` に移動

#### 問題のある箇所

- [`src/scrapers/anaslo.py:169-175`](../src/scrapers/anaslo.py#L169)
- [`src/scrapers/minrepo.py:200-206`](../src/scrapers/minrepo.py#L200)

```python
# anaslo.py / minrepo.py 両方に完全同一で存在
def _today_str(self) -> str:
    """今日の日付を YYYY-MM-DD 形式で返す"""
    return datetime.now().strftime("%Y-%m-%d")

def _yesterday_str(self) -> str:
    """昨日の日付を YYYY-MM-DD 形式で返す"""
    return (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
```

コメントまで「テストでモックしやすいよう分離」と完全に同一内容が2箇所にある。

#### 実施メリット

- 将来スクレイパーを追加するたびにコピーされる種類のコードであり、早期に集約することで以降の重複増加を防げる
- テストでのモック対象が `BaseScraper` 1箇所に集まる
- `daidata` / `teramoba` も `datetime.now()` を直接呼んでおり（[daidata.py:77](../src/scrapers/daidata.py#L77)、[teramoba.py:75](../src/scrapers/teramoba.py#L75)）、候補2と合わせることで全スクレイパーに恩恵が波及する

#### 修正方針

1. `src/scrapers/base.py` の `BaseScraper` に `_today_str()` と `_yesterday_str()` を追加する
2. `base.py` の import に `from datetime import timedelta` を追加する（`datetime` は既存）
3. `anaslo.py` と `minrepo.py` の同名メソッド定義を削除する

変更ファイル: `src/scrapers/base.py`、`src/scrapers/anaslo.py`、`src/scrapers/minrepo.py`

---

### 候補 2: `result` 辞書初期化を `BaseScraper._create_result_dict()` に共通化

#### 問題のある箇所

- [`src/scrapers/anaslo.py:101-107`](../src/scrapers/anaslo.py#L101)
- [`src/scrapers/minrepo.py:107-113`](../src/scrapers/minrepo.py#L107)
- [`src/scrapers/daidata.py:75-81`](../src/scrapers/daidata.py#L75)
- [`src/scrapers/teramoba.py:73-79`](../src/scrapers/teramoba.py#L73)

```python
# anaslo / minrepo: _today_str() を使用
result: Dict[str, Any] = {
    "store_id": self.store_id,
    "play_date": date or self._today_str(),
    "machines": [],
    "error": None,
    "http_status": None,
}

# daidata / teramoba: datetime.now() を直接呼び出し（表現にばらつきあり）
result = {
    "store_id": self.store_id,
    "play_date": datetime.now().strftime("%Y-%m-%d"),
    "machines": [],
    "error": None,
    "http_status": None,
}
```

4スクレイパー全体で同じキー構造の辞書を初期化しているが、`play_date` の設定方法が2通りに分かれている。

#### 実施メリット

- `result` 辞書に将来キーを追加する場合（例: `"source_site"` フィールドなど）、1箇所の修正で全スクレイパーに反映される
- `daidata` / `teramoba` でも候補1の `_today_str()` が自動的に使われるようになり、日付生成ロジックが統一される
- 候補1と組み合わせることで効果が最大化される（相乗効果あり）

#### 修正方針

1. `BaseScraper` に以下のメソッドを追加する

```python
def _create_result_dict(self, play_date: Optional[str] = None) -> Dict[str, Any]:
    return {
        "store_id": self.store_id,
        "play_date": play_date or self._today_str(),
        "machines": [],
        "error": None,
        "http_status": None,
    }
```

2. 4スクレイパーの `result = {...}` を以下に置き換える

```python
# anaslo / minrepo（date 引数あり）
result = self._create_result_dict(date)

# daidata / teramoba（date 引数なし）
result = self._create_result_dict()
```

3. `daidata.py` と `teramoba.py` の `from datetime import datetime` が不要になる場合は import を整理する

変更ファイル: `src/scrapers/base.py`、`src/scrapers/anaslo.py`、`src/scrapers/minrepo.py`、`src/scrapers/daidata.py`、`src/scrapers/teramoba.py`

---

## 優先度: 中

---

### 候補 3: Discord truncation を `_post()` に統合

#### 問題のある箇所

- [`src/notifier.py:84-85`](../src/notifier.py#L84)（`notify_daily_summary`）
- [`src/notifier.py:111-112`](../src/notifier.py#L111)（`notify_alert`）
- [`src/notifier.py:195-197`](../src/notifier.py#L195)（`notify_quota_status`）

```python
# 3箇所に同一コード
if len(content) > DISCORD_MAX_CHARS:
    content = content[: DISCORD_MAX_CHARS - 3] + "..."
```

#### 実施メリット

- Discord の文字数制限変更や省略表現の変更（例: 末尾を `\n[省略]` にするなど）が `_post()` 内の1箇所で完結する
- `_post()` の内部で自動処理することで、将来通知メソッドを追加した際に truncation の書き忘れが起きない

#### 修正方針

1. `Notifier` に `_truncate_for_discord()` メソッドを追加する

```python
def _truncate_for_discord(self, content: str) -> str:
    if len(content) > DISCORD_MAX_CHARS:
        return content[: DISCORD_MAX_CHARS - 3] + "..."
    return content
```

2. `_post()` の冒頭で呼び出す形に変更し、各通知メソッドの truncation コードを削除する

```python
def _post(self, content: str):
    content = self._truncate_for_discord(content)
    # ... 既存の POST 処理
```

変更ファイル: `src/notifier.py`

---

### 候補 4: `user_agent` 取得を `BaseScraper` に共通化

#### 問題のある箇所

- [`src/scrapers/base.py:58-61`](../src/scrapers/base.py#L58)（`start_browser()`）
- [`src/scrapers/base.py:111-115`](../src/scrapers/base.py#L111)（`_new_page()`）
- [`src/scrapers/anaslo.py:272-277`](../src/scrapers/anaslo.py#L272)（`_start_browser_with_referer()`）
- [`src/scrapers/minrepo.py:423-430`](../src/scrapers/minrepo.py#L423)（`_start_browser()`）

```python
# 4箇所で同じデフォルト文字列が存在
scraping_config.get(
    "user_agent",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ..."
)
```

#### 実施メリット

- デフォルト `user_agent` 文字列の変更が1箇所で完結する
- 各スクレイパーが独自の `_start_browser()` を持っていても、`_get_user_agent()` を呼ぶだけで設定値を参照できる

#### 修正方針

1. `BaseScraper` に `_get_user_agent()` プロパティを追加する

```python
@property
def _user_agent(self) -> str:
    return self.scraping_config.get(
        "user_agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    )
```

2. 4箇所の `scraping_config.get("user_agent", ...)` を `self._user_agent` に置き換える

変更ファイル: `src/scrapers/base.py`、`src/scrapers/anaslo.py`、`src/scrapers/minrepo.py`

---

## 優先度: 低

---

### 候補 5: 例外処理パターンの共通化

#### 問題のある箇所

- [`src/scrapers/anaslo.py:151-161`](../src/scrapers/anaslo.py#L151)
- [`src/scrapers/minrepo.py:182-192`](../src/scrapers/minrepo.py#L182)
- [`src/scrapers/daidata.py:120-130`](../src/scrapers/daidata.py#L120)
- [`src/scrapers/teramoba.py:115-125`](../src/scrapers/teramoba.py#L115)

```python
# 4スクレイパー全体で完全に同一
except PlaywrightTimeoutError as e:
    result["error"] = f"タイムアウト: {str(e)}"
    result["http_status"] = 504
    logger.error(f"{self.store_name}: {result['error']}")
except Exception as e:
    result["error"] = f"予期しないエラー: {str(e)}"
    logger.error(f"{self.store_name}: {result['error']}", exc_info=True)
finally:
    self.close_browser()
```

#### 実施メリット

- エラーメッセージのフォーマット変更が1箇所で完結する
- `finally: close_browser()` の書き忘れリスクがなくなる

#### 修正方針と留意点

`try/except/finally` は Python の構文上、丸ごとメソッド化が難しいため、以下の2案がある。

**A案（エラーセッタのみ共通化・変更最小）**
```python
# BaseScraper に追加
def _set_timeout_error(self, result: Dict, e: Exception) -> None:
    result["error"] = f"タイムアウト: {str(e)}"
    result["http_status"] = 504
    logger.error(f"{self.store_name}: {result['error']}")

def _set_unexpected_error(self, result: Dict, e: Exception) -> None:
    result["error"] = f"予期しないエラー: {str(e)}"
    logger.error(f"{self.store_name}: {result['error']}", exc_info=True)
```

**B案（テンプレートメソッドパターン）**
`BaseScraper.scrape()` が `try/except/finally` を持ち、内部で `_do_scrape()` を呼ぶ設計に変更する。変更範囲が大きく、既存テストへの影響が大きい。

**→ 変更コストに対してメリットが小さい。A案で対応するか、あるいは現状維持が現実的。**

---

### 候補 6: `_WAIT_MS` 定数を設定ファイルで管理

#### 問題のある箇所

- [`src/scrapers/anaslo.py:36`](../src/scrapers/anaslo.py#L36): `_WAIT_MS = 5000`
- [`src/scrapers/minrepo.py:45`](../src/scrapers/minrepo.py#L45): `_WAIT_MS = 5000`

値が同じ `5000` だが、別の定数として管理されている。

#### 実施メリット

- 実行環境によっては JS レンダリング待ち時間を調整したい場面があり（低スペック PC や CI 環境）、設定ファイル化することで環境ごとに調整できる
- ただし `_HEADER_LINE` はサイト固有のため共通化不要

#### 修正方針

`config/` の YAML に `js_wait_ms: 5000` を追加し、`BaseScraper.scraping_config` 経由で取得する。

```python
_WAIT_MS = self.scraping_config.get("js_wait_ms", 5000)
```

変更ファイル: `config/scraping.yml`（または既存設定ファイル）、`src/scrapers/anaslo.py`、`src/scrapers/minrepo.py`

---

---

## ファイル分割

---

### 候補 10: `cli.py` の責務分割

#### 問題のある箇所

[`src/cli.py`](../src/cli.py) は現在 **1,189行** と突出して大きく、以下の異なる責務が1ファイルに混在している。

| 責務 | 該当箇所 | 行数 |
|------|---------|------|
| 環境初期化・ロギング設定 | `setup_logging()`, `init_environment()` | ~80行 |
| スクレイパー起動・DB書き込みの共通処理 | `_run_scraper_for_date()`, `select_stores_for_backfill()` | ~250行 |
| `collect` コマンド処理 | `cmd_collect()` | ~310行 |
| `backfill` コマンド処理 | `cmd_backfill()` | ~200行 |
| `status` コマンド処理 + ギャップ検出ロジック | `cmd_status()`, `detect_gaps()` 他 | ~270行 |
| argparse 定義・エントリポイント | `main()` | ~180行 |

特に深刻なのは、`cmd_collect()` の DB 書き込みブロック（[:320-389](../src/cli.py#L320)）と `_run_scraper_for_date()` の DB 書き込みブロック（[:1000-1068](../src/cli.py#L1000)）が**ほぼ同一の SQLite upsert コードを重複して持っている**点。`collect` と `backfill` の両方から呼ばれる処理が共通化されておらず、片方を修正するともう片方の修正漏れが起きやすい。

また、`_run_scraper_for_date()` や `detect_gaps()` は `cli.py` の内部関数として定義されているため、**現状テストが書けない状態**になっている。

#### 実施メリット

- DB 書き込みの重複コードが1箇所に統合され、修正漏れリスクがなくなる
- `collector.py` として独立させることで `_run_scraper_for_date()` に直接テストが書けるようになる
- 各コマンドファイルが独立するため、「`collect` の挙動を変えたい」という場面で `cli.py` 全体を読まずに済む
- 新コマンドを追加する際に `cli.py` への追記ではなく `commands/` への新ファイル追加で完結し、肥大化が止まる
- `main()` が argparse 定義のみになり、コマンド一覧の見取り図として機能するようになる

#### 修正方針

以下の構成に分割する。

```
src/
├── cli.py              → argparse 定義 + main() のみ（~180行）
├── collector.py        → スクレイパー起動・DB書き込みの共通処理（新規・~200行）
│                           _run_scraper_for_date()
│                           select_stores_for_backfill()
│                           _save_machines_to_db()  ← 重複DBコードを統合
└── commands/
    ├── __init__.py
    ├── collect.py      → cmd_collect()（~200行）
    ├── backfill.py     → cmd_backfill()（~200行）
    └── status.py       → cmd_status(), detect_gaps() 他（~270行）
```

各ファイルの役割：

- **`collector.py`（新規）**: `cmd_collect` と `cmd_backfill` の両方が使うスクレイパー起動・DB保存の共通処理を集約する。重複している SQLite upsert コードはここに `_save_machines_to_db()` として1本化する。
- **`commands/collect.py`**: `cmd_collect()` を移動する。`collector.py` の関数を import して使う形に整理する。
- **`commands/backfill.py`**: `cmd_backfill()` と `collect_site()`（スレッド内処理）を移動する。
- **`commands/status.py`**: `cmd_status()`・`detect_gaps()`・`_cmd_status_gaps()`・`_cmd_status_machine()`・`_cmd_status_summary()`・`_find_prev_same_store_count()` を移動する。
- **`cli.py`**: `main()` と argparse 定義のみ残す。各 `cmd_*` は `commands/` から import する。

変更ファイル: `src/cli.py`、`src/collector.py`（新規）、`src/commands/__init__.py`（新規）、`src/commands/collect.py`（新規）、`src/commands/backfill.py`（新規）、`src/commands/status.py`（新規）

#### 留意点

- `commands/` の各ファイルは `collector.py` に依存するが、`cli.py` には依存しない設計にすること（循環 import を防ぐ）
- `_NullLock` クラスは `backfill.py` が使うため、`commands/backfill.py` または `collector.py` に移動する
- 分割後も `python -m src.cli collect` 等の外部インターフェースは変えない
- 実施前に既存テスト（`tests/`）をすべてパスすることを確認し、分割後も同様にパスすることを確認する

---

## 見送り

---

### 候補 7: `_parse_machine_lines()` 骨格の共通化

#### 理由

[`src/scrapers/anaslo.py:320-356`](../src/scrapers/anaslo.py#L320) と [`src/scrapers/minrepo.py:323-360`](../src/scrapers/minrepo.py#L323) はループ骨格が類似しているが、以下の差異が大きい。

- 列数が 11列（anaslo）vs 5列（minrepo）
- `_parse_columns()` の中身が完全に異なる
- ヘッダー判定文字列がサイト固有

共通化できるのはループ骨格（ヘッダースキップ → 台番号検証 → `_parse_columns()` 呼び出し）のみで、その部分は元々コード量が少ない。共通化のコストが効果に見合わないため、**同種の新スクレイパーが増えた段階で検討する**。

---

### 候補 8: `severity_icon` / `level_icon` の統合

#### 理由

[`src/notifier.py:108`](../src/notifier.py#L108) と [`src/notifier.py:176`](../src/notifier.py#L176) の2箇所に類似辞書があるが、キー定義が異なる（`"error"` キーの有無）。統一する際の調整コストに対して、変更頻度も低くメリットが小さいため見送り。

---

### 候補 9: MB換算ロジックの共通化

#### 理由

[`src/db.py:137`](../src/db.py#L137) と [`src/quota_monitor.py:139`](../src/quota_monitor.py#L139) の2箇所のみ。それぞれ独立したクラス内に存在し、実害もない。`src/utils/` ディレクトリを作成する機会があれば `bytes_to_mb()` として追加検討する程度。

---

## 実施順序（推奨）

候補 1・2 はコードの依存関係があるためセットで実施するのが効率的。候補 10 は他の候補と独立しているため、どのタイミングで実施しても問題ない。

```
第1ステップ: 候補1 + 候補2（BaseScraper への日付ヘルパー + result 辞書共通化）✅ 完了
第2ステップ: 候補3（notifier.py の truncation 統合）                          ✅ 完了
第3ステップ: 候補4（user_agent 共通化）                                       ✅ 完了
第4ステップ: 候補10（cli.py の責務分割）
第5ステップ: 候補5・6（必要と判断した場合のみ）
```

各ステップは TDD で実施する（先にテスト修正 → 実装変更の順）。

---

---

## バックエンド パフォーマンス改善候補

作成日: 2026-06-03

### 背景・前提

現在のデータ規模（9店舗 × 最大 800 台/日）では顕在化していない問題が主。**店舗数・台数が倍以上になる段階での対応でも問題ない**。インデックスは `idx_store_date`（store_id + play_date）・`idx_machine_name` が定義済みで主要クエリは最適化されている。

---

### 全体サマリ

| 優先度 | # | 候補 | 対象 | 推定改善度 |
|--------|---|------|------|----------|
| 中 | BP-1 | `_save_machines_to_db()` のバッチインサート化 | `src/cli.py` | DB 書込 30-50% 削減 |
| 中 | BP-2 | `exporter.py` の N+1 クエリ統合 | `src/exporter.py` | export 時間 70-80% 削減 |
| 低 | BP-3 | `_build_top_machines()` の NULL フィルタを DB 側に移動 | `src/exporter.py` | メモリ使用量削減 |
| 見送り | BP-4 | `cmd_collect()` の並行化 | `src/cli.py` | IP ブロック対策で直列が設計要件 |

---

### 候補 BP-1: `_save_machines_to_db()` のバッチインサート化

#### 問題のある箇所

- [`src/cli.py`](../src/cli.py)（`_save_machines_to_db()` 内の upsert ループ）

```python
for machine in machines:
    stmt = sqlite_insert(DMD).values(...)  # 1台ずつ INSERT/UPDATE
    session.execute(stmt)
    saved += 1
```

100 台のデータで 100 回の INSERT/UPDATE が発生する。SQLite のトランザクション内でも、実行回数が多いほどオーバーヘッドが積み重なる。

#### 影響度

- 1日 9 店舗 × 800 台 = 7,200 回の INSERT（現状）
- backfill で 30 日分 = 216,000 回
- 店舗数が倍増すると比例して遅くなる

#### 修正方針

SQLite の `INSERT OR REPLACE` 一括実行か、`executemany()` による一括処理に変更する。

```python
# 現在: ループ内で 1 件ずつ execute
for machine in machines:
    session.execute(sqlite_insert(DMD).values(...).on_conflict_do_update(...))

# 改善案: values リストを構築してから 1 回の executemany
records = [build_record(m) for m in machines]
session.execute(sqlite_insert(DMD), records)
# ただし SQLite の on_conflict_do_update との組み合わせは要検証
```

**留意点**: SQLAlchemy の `on_conflict_do_update` と `executemany` の組み合わせは SQLite 方言依存のため、テストで動作確認が必要。

変更ファイル: `src/cli.py`

---

### 候補 BP-2: `exporter.py` の N+1 クエリ統合

#### 問題のある箇所

- [`src/exporter.py`](../src/exporter.py)（`_build_stores()` メソッド）

```python
for group_key, meta in groups.items():  # グループ数（現在 9）回ループ
    latest_date = session.query(func.max(DailyMachineData.play_date))
        .filter(DailyMachineData.store_id.in_(store_ids)).scalar()   # クエリ 1
    oldest_date = session.query(func.min(DailyMachineData.play_date))
        .filter(DailyMachineData.store_id.in_(store_ids)).scalar()   # クエリ 2
    rows_on_date = session.query(...)
        .filter(...).all()                                            # クエリ 3
    # + machine_count の SELECT                                       # クエリ 4
```

グループ数 × 4 クエリ = 最大 36 回の SELECT が export のたびに走る。

#### 影響度

- 現在 9 グループ × 4 クエリ = 36 回（体感 1-2 秒）
- グループ数が増えると線形に増加する

#### 修正方針

集計クエリを1本に統合して Python 側でマッピングする。

```python
# グループ別の最新日・最古日・台数を 1 クエリで取得
agg = session.query(
    DailyMachineData.store_id,
    func.max(DailyMachineData.play_date).label("latest"),
    func.min(DailyMachineData.play_date).label("oldest"),
    func.count(DailyMachineData.id).label("count"),
).group_by(DailyMachineData.store_id).all()
# → store_id をキーに dict 化してからグループループで参照
```

変更ファイル: `src/exporter.py`

---

### 候補 BP-3: `_build_top_machines()` の NULL フィルタを DB 側に移動

#### 問題のある箇所

- [`src/exporter.py`](../src/exporter.py)（`_build_top_machines()`）

```python
rows = session.query(DailyMachineData)
    .filter(DailyMachineData.play_date >= since)
    .all()                          # 直近14日の全データを Python メモリに読み込み
for r in rows:
    if r.diff_coins is None:        # Python 側でフィルタ
        continue
```

`diff_coins` が NULL の行（minrepo データ等）を Python 側でスキップしているが、DB 側フィルタにするとネットワーク転送量とメモリ使用量を削減できる。

#### 影響度

- 現在のデータ量（最大 7,200 行/日 × 14 日 = 100,800 行）では数 MB 程度
- minrepo の割合が高まると NULL 行が増え、無駄なデータ転送が増加する

#### 修正方針

```python
rows = session.query(DailyMachineData)
    .filter(
        DailyMachineData.play_date >= since,
        DailyMachineData.diff_coins.isnot(None),  # DB 側でフィルタ
    ).all()
```

変更ファイル: `src/exporter.py`

---

### 見送り: BP-4 `cmd_collect()` の並行化

#### 理由

店舗間の sleep（30-60 秒）は IP ブロック対策として設計要件であり、直列処理が必須。並行化しても sleep がボトルネックになるため改善効果がない。backfill はサイト別スレッド並行が実装済みで、これ以上の並行化は不要。

---

---

## フロントエンド（docs/index.html）リファクタリング・パフォーマンス改善候補

作成日: 2026-06-03

### 背景・目的

`docs/index.html` は CSS・HTML・JS を1ファイルに収めた約1100行の構成。機能追加が続いた結果、JS 部分（L441–L1076）に重複コード・未使用コード・パフォーマンス上の問題が蓄積している。

**扱うデータ規模の目安**
- `machines/YYYY-MM-DD.json` に1店舗あたり最大 800 台
- 機種ランキング集計: 直近14日 × 最大9店舗 = 最大126ファイルを並行 fetch
- 全台リストモーダル: 1回あたり最大 800 行の描画
- 機種別サマリ集計: 800件を毎回フルスキャン

**注意事項**: テストが存在しない単一 HTML ファイルのため、変更後は必ずブラウザで動作確認を行うこと。
確認方法: `cd docs && python -m http.server 8080` → http://localhost:8080

---

### 全体サマリ

#### パフォーマンス

| 優先度 | # | 候補 | 影響が出るタイミング |
|--------|---|------|---------------------|
| 高 | FP-1 | machines JSON のキャッシュ（`machinesCache`） | モーダルを繰り返し開くとき |
| 高 | FP-2 | `initMachineTableSort` / `initModelTableSort` → イベント委任に置換 | モーダルを開くたびに DOM 再構築 |
| 中 | FP-3 | `buildModelSummary` の結果をキャッシュ | 機種別サマリのソート連打時 |
| 低 | FP-4 | `buildAndRenderTopMachines` の中間配列削減 | データが大幅増加した場合 |

#### 重複コード・コード品質

| 優先度 | # | 候補 | 重複箇所数 |
|--------|---|------|----------|
| 高 | F-1 | フィルタ UI リセットの共通化（`resetFilterUI()`） | 3 |
| 高 | F-2 | ソートインジケーター更新の共通化（`updateSortIndicators()`） | 2 |
| 中 | F-3 | ページャー同期処理の共通化（`setPagerState()`）+ バグ修正 | 2 |
| 低 | F-4 | `fmtPct()` 未使用関数を削除 | 1 |
| 低 | F-5 | 未使用 `groups` 変数を削除 | 1 |
| 見送り | F-6 | `renderMachineTable()` の責務分割 | — |

---

## 優先度: 高（パフォーマンス）

---

### 候補 FP-1: machines JSON のキャッシュ（`machinesCache`）

#### 問題のある箇所

- [`docs/index.html:686-696`](index.html#L686)（`buildAndRenderTopMachines()` 内の fetch）
- [`docs/index.html:807-809`](index.html#L807)（`openMachineModal()` 内の fetch）

```js
// buildAndRenderTopMachines が同じファイルを取得済みでも…
const res = await fetch(`data/machines/${d}.json`);

// openMachineModal でも同じファイルを再 fetch している
const res = await fetch(`data/machines/${playDate}.json`);
```

同じ `data/machines/YYYY-MM-DD.json` を2つの独立した経路が別々に取得している。GitHub Pages のキャッシュ設定によっては毎回ネットワークリクエストが走る。

#### 実施メリット

- 同日の店舗モーダルを何度開き直しても fetch が走らなくなる
- `buildAndRenderTopMachines` 実行後は直近14日のモーダルが即時表示される

#### 修正方針

```js
// モジュールスコープに追加
const machinesCache = new Map(); // key: "YYYY-MM-DD", value: JSON オブジェクト

// fetch 共通ヘルパーを新設（buildAndRenderTopMachines / openMachineModal 両方から使用）
async function fetchMachinesJson(date) {
  if (machinesCache.has(date)) return machinesCache.get(date);
  try {
    const res = await fetch(`data/machines/${date}.json`);
    if (!res.ok) return null;
    const data = await res.json();
    machinesCache.set(date, data);
    return data;
  } catch (_) { return null; }
}
```

変更ファイル: `docs/index.html`

---

### 候補 FP-2: `initMachineTableSort` / `initModelTableSort` → イベント委任に置換

#### 問題のある箇所

- [`docs/index.html:903-920`](index.html#L903)（`initMachineTableSort()`）
- [`docs/index.html:1018-1033`](index.html#L1018)（`initModelTableSort()`）

```js
function initMachineTableSort() {
  // モーダルを開くたびに DOM を破壊・再構築してリスナーを登録し直す
  document.querySelectorAll("#machine-table th.sortable").forEach(th => {
    th.replaceWith(th.cloneNode(true));  // DOM 再作成（reflow を強制）
  });
  document.querySelectorAll("#machine-table th.sortable").forEach(th => {
    th.addEventListener("click", () => { ... });
  });
}
```

`replaceWith(cloneNode(true))` は DOM ノードを毎回破壊・再構築する壊れやすいパターン。モーダルを開くたびに不要な reflow を強制する。

#### 実施メリット

- DOM の破壊・再構築と reflow がなくなる
- イベントリスナーの登録が `DOMContentLoaded` 時の1回のみになる
- F-3 相当（`initTableSort` 共通化）が同時に解決される

#### 修正方針

テーブル親要素へのイベント委任（event delegation）を使い、`DOMContentLoaded` 時に1回だけ登録する。

```js
// DOMContentLoaded 内（init() の前）に追加
document.getElementById("machine-table").addEventListener("click", e => {
  const th = e.target.closest("th.sortable");
  if (!th) return;
  if (modalSortCol === th.dataset.col) {
    modalSortAsc = !modalSortAsc;
  } else {
    modalSortCol = th.dataset.col;
    modalSortAsc = ["machine_number", "machine_name"].includes(modalSortCol);
  }
  renderMachineTable();
});

document.getElementById("model-table").addEventListener("click", e => {
  const th = e.target.closest("th.sortable");
  if (!th) return;
  if (modelSortCol === th.dataset.col) {
    modelSortAsc = !modelSortAsc;
  } else {
    modelSortCol = th.dataset.col;
    modelSortAsc = th.dataset.col === "machine_name";
  }
  renderModelTable();
});
```

- `initMachineTableSort()` / `initModelTableSort()` 関数を削除する
- `openMachineModal()` 内の `initMachineTableSort(); initModelTableSort();` 呼び出し（L828-829）を削除する

変更ファイル: `docs/index.html`

---

## 優先度: 高（重複コード）

---

### 候補 F-1: フィルタ UI リセット処理を `resetFilterUI()` に共通化

#### 問題のある箇所

- [`docs/index.html:821-823`](index.html#L821)（`openMachineModal()` 内）
- [`docs/index.html:835-838`](index.html#L835)（`closeMachineModal()`）
- [`docs/index.html:941-944`](index.html#L941)（`resetMachineFilter()`）

```js
// 3箇所に完全同一で存在
machineFilter = null;
document.getElementById("tab-btn-all").textContent = "全台リスト";
document.getElementById("show-all-btn").style.display = "none";
```

#### 実施メリット

- 「全台リストを表示」ボタンのラベル文字列変更が1箇所で完結する
- フィルタ状態が増えた場合も `resetFilterUI()` を変更するだけで全箇所に反映される

#### 修正方針

```js
function resetFilterUI() {
  machineFilter = null;
  document.getElementById("tab-btn-all").textContent = "全台リスト";
  document.getElementById("show-all-btn").style.display = "none";
}
```

- `openMachineModal()` の L821-823 → `resetFilterUI()` に置き換える
- `closeMachineModal()` の L835-838 → `currentMachines = []; resetFilterUI();` に置き換える
- `resetMachineFilter()` の L941-944 → `resetFilterUI(); switchModalTab("all");` に置き換える

変更ファイル: `docs/index.html`

---

### 候補 F-2: ソートインジケーター更新を `updateSortIndicators()` に共通化

#### 問題のある箇所

- [`docs/index.html:894-900`](index.html#L894)（`renderMachineTable()` 末尾）
- [`docs/index.html:1009-1015`](index.html#L1009)（`renderModelTable()` 末尾）

```js
// renderMachineTable 末尾（テーブル id と変数名だけ異なる同一コードが renderModelTable にも存在）
document.querySelectorAll("#machine-table th.sortable").forEach(th => {
  th.classList.remove("sort-asc", "sort-desc");
  if (th.dataset.col === modalSortCol) {
    th.classList.add(modalSortAsc ? "sort-asc" : "sort-desc");
  }
});
```

#### 実施メリット

- CSS クラス名（`sort-asc` / `sort-desc`）の変更が1箇所で完結する

#### 修正方針

```js
function updateSortIndicators(tableSelector, sortCol, sortAsc) {
  document.querySelectorAll(`${tableSelector} th.sortable`).forEach(th => {
    th.classList.remove("sort-asc", "sort-desc");
    if (th.dataset.col === sortCol) {
      th.classList.add(sortAsc ? "sort-asc" : "sort-desc");
    }
  });
}
// renderMachineTable 末尾
updateSortIndicators("#machine-table", modalSortCol, modalSortAsc);
// renderModelTable 末尾
updateSortIndicators("#model-table", modelSortCol, modelSortAsc);
```

**注意**: FP-2（イベント委任）と組み合わせて実施する場合、`updateSortIndicators` は引き続き有効。FP-2 後も `renderMachineTable` / `renderModelTable` から呼ばれるため、どちらを先に実施しても矛盾しない。

変更ファイル: `docs/index.html`

---

## 優先度: 中

---

### 候補 FP-3: `buildModelSummary` の結果をキャッシュ

#### 問題のある箇所

- [`docs/index.html:977-1016`](index.html#L977)（`renderModelTable()` 冒頭）

```js
function renderModelTable() {
  let summary = buildModelSummary(currentMachines);  // ソートのたびに毎回 800件フルスキャン
  summary.sort(...);
  tbody.innerHTML = ...;
}
```

`currentMachines`（最大 800 件）のフルスキャン集計を、機種別サマリタブでのソートのたびに実行している。`currentMachines` は `openMachineModal()` でのみ更新されるため集計結果は変わらない。

#### 修正方針

```js
let _modelSummaryCache = null;

// openMachineModal 内で currentMachines セット直後に集計
_modelSummaryCache = buildModelSummary(currentMachines);

// renderModelTable はキャッシュを使ってソートのみ
function renderModelTable() {
  if (!_modelSummaryCache) { ... return; }
  const summary = [..._modelSummaryCache].sort(...);
  ...
}

// closeMachineModal でキャッシュをクリア
_modelSummaryCache = null;
```

変更ファイル: `docs/index.html`

---

### 候補 F-3: ページャー同期処理を `setPagerState()` に共通化 + バグ修正

#### 問題のある箇所

- [`docs/index.html:773-787`](index.html#L773)（`renderTopMachines()` 内）

```js
// 上部（L777-780）と下部（L781-784）で id の末尾 "-bottom" 以外が同一
pager.style.display = "block";
document.getElementById("top-machines-page-info").textContent = info;
document.getElementById("top-machines-prev").disabled = atFirst;
document.getElementById("top-machines-next").disabled = atLast;
// ↓ 下部も全く同じ（"-bottom" サフィックスのみ違う）
pagerBottom.style.display = "block";
...
```

#### 潜在バグ

データが 0 件のとき（L752-754）`pager.style.display = "none"` のみで **`pagerBottom` の非表示処理が漏れている**。ページ遷移後にデータ 0 件になると下部ページャーが残ったまま表示される。

#### 修正方針

```js
function setPagerState(suffix, visible, info = "", atFirst = true, atLast = true) {
  const s = suffix ? `-${suffix}` : "";
  document.getElementById(`top-machines-pager${s}`).style.display = visible ? "block" : "none";
  if (visible) {
    document.getElementById(`top-machines-page-info${s}`).textContent = info;
    document.getElementById(`top-machines-prev${s}`).disabled = atFirst;
    document.getElementById(`top-machines-next${s}`).disabled = atLast;
  }
}

// renderTopMachines 内
setPagerState("",       false);  // ← データなし時のバグ修正（pagerBottom も非表示に）
setPagerState("bottom", false);

// データあり時
setPagerState("",       totalPages > 1, info, atFirst, atLast);
setPagerState("bottom", totalPages > 1, info, atFirst, atLast);
```

変更ファイル: `docs/index.html`

---

## 優先度: 低

---

### 候補 F-4: `fmtPct()` 未使用関数を削除

- [`docs/index.html:496-498`](index.html#L496)

```js
function fmtPct(v) {        // 呼び出し元がコード全体に存在しない
  return (v * 100).toFixed(1) + "%";
}
```

削除前に全文検索で `fmtPct` が 0 件であることを確認すること。

変更ファイル: `docs/index.html`

---

### 候補 F-5: 未使用 `groups` 変数を削除

- [`docs/index.html:685`](index.html#L685)

```js
const groups = {};  // 宣言のみ。以降どこでも参照されていない残骸
```

変更ファイル: `docs/index.html`

---

### 候補 FP-4: `buildAndRenderTopMachines` の中間配列削減（見送りに近い低優先度）

#### 理由

現状の集計対象は最大「機種種類数 × 14日 × 9店舗」行（数千〜1万件）。`rows.sort()` は数十ms 程度で「集計中…」表示がカバーする。データ量が数倍になった段階で再検討。

---

## 見送り

---

### 候補 F-6: `renderMachineTable()` の責務分割

#### 理由

フィルタ・ソート・HTML 生成・インジケーター更新の4責務が混在しているが、FP-2（イベント委任）+ F-2（`updateSortIndicators`）の実施でインジケーター更新が分離され責務の混在は緩和される。残る3責務の分割は呼び出し順管理という新たな複雑さを生み、約50行の関数規模では費用対効果が小さい。

---

## フロントエンド 実施順序（推奨）

テストが存在しないため、**各ステップ後にブラウザ動作確認を必須**とする。

```
第1ステップ: F-4・F-5（デッドコード除去）+ F-1（resetFilterUI）
             → リスクゼロの変更を先に済ませる
第2ステップ: FP-1（machinesCache + fetchMachinesJson ヘルパー新設）
             → fetch 経路を統合してからイベント改修に進む
第3ステップ: FP-2（イベント委任・initMachineTableSort / initModelTableSort 削除）
             → openMachineModal から init 呼び出しも削除
第4ステップ: F-2（updateSortIndicators）
             → FP-2 後も残る querySelectorAll ループを共通化
第5ステップ: FP-3（buildModelSummary キャッシュ）
第6ステップ: F-3（setPagerState + pagerBottom バグ修正）
```
