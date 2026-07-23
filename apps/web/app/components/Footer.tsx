export function Footer() {
  return (
    <footer className="bg-gray-50 border-t border-gray-200 mt-16 py-10">
      <div className="max-w-4xl mx-auto px-4">
        {/* PR・広告表記（景表法対応） */}
        <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm">
          <p className="font-bold text-amber-900 mb-1">【広告・PR】</p>
          <p className="text-amber-800">
            本サイトはアフィリエイト広告（成果報酬型広告）を利用しています。
            掲載している広告の情報は記事作成時点のものです。
          </p>
        </div>

        {/* 法的導線 */}
        <nav className="flex flex-wrap gap-x-6 gap-y-2 mb-6 text-sm">
          <a href="/disclaimer" className="text-gray-600 hover:text-gray-900 underline">
            免責事項
          </a>
          <a href="/privacy" className="text-gray-600 hover:text-gray-900 underline">
            プライバシーポリシー
          </a>
          <a href="/contact" className="text-gray-600 hover:text-gray-900 underline">
            お問い合わせ
          </a>
        </nav>

        <p className="text-xs text-gray-400">
          © {new Date().getFullYear()} くらべて選ぶラボ. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
