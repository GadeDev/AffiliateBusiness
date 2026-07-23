import Link from 'next/link';
import { lpConfigs, shindanConfigs } from '@affiliate/shared';

export default function HomePage() {
  return (
    <main className="max-w-4xl mx-auto px-4 py-12">
      <h1 className="text-4xl font-extrabold mb-2 text-indigo-700">くらべて選ぶラボ</h1>
      <p className="text-gray-500 mb-12">AI運用型アフィリエイト事業基盤</p>

      <div className="grid sm:grid-cols-2 gap-8">
        <section>
          <h2 className="text-xl font-bold mb-4 text-gray-800 border-b pb-2">LP 一覧</h2>
          <ul className="space-y-3">
            {lpConfigs.map((lp) => (
              <li key={lp.slug}>
                <Link
                  href={`/lp/${lp.slug}`}
                  className="block p-4 bg-indigo-50 rounded-xl hover:bg-indigo-100 transition-colors"
                >
                  <p className="font-semibold text-indigo-700">{lp.title}</p>
                  <p className="text-sm text-gray-500 mt-1">/lp/{lp.slug}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-bold mb-4 text-gray-800 border-b pb-2">診断 LP 一覧</h2>
          <ul className="space-y-3">
            {shindanConfigs.map((s) => (
              <li key={s.slug}>
                <Link
                  href={`/shindan/${s.slug}`}
                  className="block p-4 bg-purple-50 rounded-xl hover:bg-purple-100 transition-colors"
                >
                  <p className="font-semibold text-purple-700">{s.title}</p>
                  <p className="text-sm text-gray-500 mt-1">/shindan/{s.slug}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="mt-12 p-4 bg-gray-100 rounded-xl text-sm text-gray-600">
        <p className="font-semibold mb-1">クリック計測テスト</p>
        <p>
          <Link
            href="/go/sample-offer-1?utm_source=test&utm_medium=direct&utm_campaign=p0"
            className="text-blue-600 underline"
          >
            /go/sample-offer-1?utm_source=test&utm_medium=direct&utm_campaign=p0
          </Link>
        </p>
      </div>
    </main>
  );
}
