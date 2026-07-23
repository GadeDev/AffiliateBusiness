import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getLPConfigBySlug } from '@affiliate/shared';
import { LPTemplate } from '@/app/components/LPTemplate';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const config = await getLPConfigBySlug(slug);
  if (!config) return {};
  const description = config.content?.metaDescription || config.description;
  return { title: config.title, description };
}

export default async function LPPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const config = await getLPConfigBySlug(slug);
  if (!config) notFound();

  return <LPTemplate config={config} />;
}
