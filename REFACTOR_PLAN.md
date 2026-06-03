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
第1ステップ: 候補1 + 候補2（BaseScraper への日付ヘルパー + result 辞書共通化）
第2ステップ: 候補3（notifier.py の truncation 統合）
第3ステップ: 候補4（user_agent 共通化）
第4ステップ: 候補10（cli.py の責務分割）
第5ステップ: 候補5・6（必要と判断した場合のみ）
```

各ステップは TDD で実施する（先にテスト修正 → 実装変更の順）。
