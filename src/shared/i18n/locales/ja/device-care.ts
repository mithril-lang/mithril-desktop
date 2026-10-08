export default {
  folderTrail: "フォルダーの階層",
  upFolder: "親フォルダーへ",
  measured: "測定した範囲",
  partialShort: "一部のみ測定",
  moreFolders:
    "大きい順に48項目を表示。このフォルダーを詳細分析すると範囲を絞れます。",
  inspectFolder: "このフォルダーを詳細分析",
  causeTitle: "容量を占める原因の手掛かり",
  causeNote:
    "パス名からの推測です。原因の確定や削除の許可ではありません。完全な測定同士の比較で増加を確認します。",
  registryWorkflow: "Registry · ストレージ管理",
  registryWorkflowNote:
    "容量を測る → 増加を比較 → 所有者と使用状況を確認 → 清掃対象を個別レビュー → 空き容量を再測定。",
  mapNote:
    "面積は測定したファイルサイズに比例します。フォルダーを開くと内訳へ進み、小さな項目も一覧で確認できます。",
  groupNote:
    "清掃には対象を確認した計画が必要です。ソース・会話・認証情報・モデル・復旧データは原則保持します。",
  cause: {
    protected:
      "履歴・ソース・復旧データの可能性があります。保持し、所有アプリの保存期間やエクスポート設定を確認します。",
    dependencies:
      "依存パッケージや開発環境が蓄積している可能性。使用中のプロジェクトと再インストール方法を確認します。",
    cache:
      "アプリのキャッシュの可能性。所有アプリ・使用状況・公式の再生成方法を確認します。",
    logs: "ログが蓄積している可能性。保存期間と書き込み元を確認してから、古いログをレビューします。",
    models:
      "ローカルモデルの重みの可能性。利用設定と再取得方法を確認してから、未使用の版をレビューします。",
    downloads:
      "ダウンロードやインストーラーの可能性。原本と復旧用コピーを確認し、対象を個別に選びます。",
    unknown:
      "名前だけでは原因を特定できません。大きいファイルと所有アプリを先に確認します。",
  },

  analyzeHome: "ホームフォルダーを分析（範囲限定・読み取り専用）",
  diskMap: "ディスク容量の概要",
  occupied: "使用済み・利用不可",
  occupiedShort: "使用済み・利用不可",
  volumeNote:
    "ボリューム全体の値です。以下のフォルダー分析とは測定範囲が異なります。",
  folderMap: "測定したフォルダーの内訳",
  partialMap: "一部が未測定です。未検査のファイルはグラフに含まれません。",
  rootFiles: "このフォルダー直下のファイル",
  otherGroups: "その他の測定済みグループ",
  noMeasuredFiles: "この範囲で通常ファイルは測定されていません。",
  allocatedNote:
    "割当済み容量は推定値です。ハードリンクは一度だけ数えます。APFS クローン、圧縮、スナップショットにより実際の空き容量と異なる場合があります。",

  vendor:
    "製品連携の状態は ClamAV と別に測定します。ローカル隔離は Mithril の保管機能で、Trend Micro の隔離機能とは別です。",
  monitorTitle: "ClamAV バックグラウンド検査",
  monitorNote:
    "Desktop 起動中、選択フォルダーを 60 秒ごとに検査します。終了時に停止し、再起動後は再選択が必要です。ファイル到着後の検出で、アクセスは阻止できません。自動隔離はしません。大きな範囲や検査上限による未検査が残ります。",
  monitorOn: "バックグラウンド検査：有効",
  monitorOff: "バックグラウンド検査：停止",
  lastRun: "前回の検査開始",
  startMonitor: "フォルダーを選んでバックグラウンド検査を開始",
  stopMonitor: "次回以降の検査を停止",
  quarantineTitle: "端末内の暗号化隔離",
  quarantineNote:
    "ClamAV の検出を確認し、対象ファイルごとに承認して暗号化コピーを保管します。所有する 25 MiB 以下のファイルが対象です。移動前に捕捉した内容を再検査します。復元先は新規ファイルで、上書き・実行はしません。OS キーリングが必要です。中断時の原本は非公開の device-care-quarantine 保管庫に保全します。",
  reviewQuarantine: "隔離できる検出を確認",
  quarantineAction: "暗号化隔離を確認…",
  restoreAction: "復元先を選んで確認…",
  noQuarantine: "隔離項目はありません",
  vendorTitle: "Trend Micro 製品との連携",
  consumerNote:
    "個人向けはインストール済み Antivirus for Mac を開きます。保護・契約・隔離の状態は未測定です。製品側で確認・操作してください。",
  consumerInstalled: "Antivirus for Mac を検出しました（保護状態は未測定）",
  consumerMissing: "この OS で Antivirus for Mac を検出していません",
  openConsumer: "Trend Micro Antivirus を開く",
  visionNote:
    "選択地域のテナントから Workbench アラートを読み取ります。最初のページ（最大 10 件）のみです。検体送信・遠隔操作は行いません。この端末への対応付けはなく、ローカル隔離の権限にはなりません。トークンは OS キーリングで暗号化します。読取時は選択した公式地域 API にだけトークンを送ります。",
  region: "API 地域",
  apiToken: "Vision One API トークン",
  saveVendor: "接続情報を保存",
  configured: "接続情報保存済み（認証は未確認）",
  notConfigured: "未設定",
  readAlerts: "テナントのアラートを読み取る",
  disconnectVendor: "保存した接続情報を削除",
  moreAlerts: "後続ページがあります。表示範囲は一部です。",
  quarantineState: {
    pending: "保留・復旧確認",
    quarantined: "隔離済み",
    "recovery-required": "復旧確認が必要",
    restored: "復元済み（コピー保全）",
  },
  title: "端末の保護とメンテナンス",
  subtitle: "このコンピューターのウイルス検査とストレージ管理",
  overview: "概要",
  protection: "保護",
  storage: "ストレージ",
  history: "履歴",
  local: "この端末 · ローカル実行",
  refresh: "状態を更新",
  loading: "処理中…",
  engine: "検査エンジン",
  missing: "対応する検査エンジンが見つかりません",
  resident: "常駐保護の状態：未測定",
  signature: "ウイルス定義",
  unknown: "未測定",
  scan: "フォルダーを選んで検査",
  cancel: "キャンセル",
  scanNote:
    "ClamAV で選択したフォルダーをローカル検査します。ファイルはアップロードしません。上限はファイル 25 MiB、展開 100 MiB、深さ 16、10 分です。シンボリックリンク・別ボリュームは除外され、検査範囲は限定されます。",
  setup:
    "ClamAV をインストールし、freshclam で定義を更新してから状態を更新してください。自動インストールは行いません。",

  noFindings:
    "検査した範囲で検出の報告はありません。端末全体の安全を保証する結果ではありません。",
  findings: "エンジンの検出結果",
  scanned: "検査したファイル",
  capacity: "ボリューム容量",
  free: "利用可能な空き容量",
  analyzeTemp: "Desktop の一時ファイルを分析",
  analyzeFolder: "フォルダーを選んで容量分析",
  cleanupNote:
    "清掃対象は Desktop が生成し、24 時間以上使われていない一時メディアだけです。チャット、認証情報、プロジェクト、モデル、他のアプリは対象外です。選択したフォルダーは分析のみです。",
  logical: "ファイルサイズ合計",
  allocated: "割当済み容量（推定）",
  files: "ファイル数",
  skipped: "除外・未測定",
  candidates: "確認できる一時ファイル",
  empty: "清掃できる一時ファイルはありません",
  largest: "大きいファイル",
  plan: "選択した対象を確認",
  execute: "確認した対象をゴミ箱へ…",
  selected: "選択した対象",
  expires: "計画の有効期限",
  trashNote:
    "次の操作で、この対象一覧に対する OS の確認画面を開きます。復元は OS のゴミ箱から行います。ゴミ箱を空にするまで空き容量は増えない場合があります。",
  moved: "ゴミ箱へ移動",
  failed: "失敗",
  bytesMoved: "移動した容量",
  before: "実行前の空き容量",
  after: "実行後の空き容量",
  recovery: "保全された復旧用ファイル",
  recoveryNote:
    "中断・失敗した清掃のファイルは、次の非公開フォルダーに保全されます。ファイル管理画面で確認してください。自動削除しません。",
  clear: "ローカル履歴を消去",
  historyNote:
    "実行概要のみ端末内に最新 100 件保存します。ファイル内容、フルパス、トークンは履歴に含めません。",
  noHistory: "実行履歴はありません",
  noAnalysis: "容量を分析すると、測定結果と清掃候補が表示されます。",
  state: {
    running: "実行中",
    complete: "完了",
    partial: "一部の範囲・結果",
    cancelled: "キャンセル済み",
    failed: "失敗",
  },
  kind: { analysis: "容量分析", cleanup: "清掃", scan: "ウイルス検査" },
} as const;
