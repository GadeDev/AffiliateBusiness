import { NextRequest, NextResponse } from 'next/server';
import { generateAndSaveLP, LPGenerationRequest, postToMultipleSNS } from '@affiliate/shared';
import { query } from '@affiliate/shared';

export async function POST(request: NextRequest) {
  try {
    const body: LPGenerationRequest = await request.json();

    // Validate required fields
    if (!body.title || !body.description || !body.targetAudience || !body.offerId) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Generate + persist LP via shared generator (same path as the batch pipeline)
    const { slug, content: lpContent } = await generateAndSaveLP({
      title: body.title,
      description: body.description,
      targetAudience: body.targetAudience,
      offerId: body.offerId,
      keywords: body.keywords,
      genre: (body as any).genre || null,
    });

    // Derive web URL from request origin (admin→web)
    const origin = request.headers.get('origin') || request.headers.get('referer') || '';
    let webBase = process.env.WEB_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || '';
    if (!webBase) {
      if (origin.includes('affiliate-admin')) {
        webBase = origin.replace('affiliate-admin', 'affiliate-web').replace(/\/[^/]*$/, '');
      } else if (origin.includes('localhost:3001')) {
        webBase = 'http://localhost:3000';
      } else {
        webBase = 'http://localhost:3000';
      }
    }
    const lpUrl = `${webBase}/lp/${slug}`;
    const selectedAccountIds = (body as any).snsAccountIds || [];

    let snsResults: any[] = [];
    if (selectedAccountIds.length > 0) {
      // Get selected accounts with character info
      const accounts = await query.all(
        `SELECT id, platform, account_name, theme, character_name, character_role,
                character_bio, character_tone, post_format, cta_style,
                forbidden_expressions, visual_direction,
                api_key, api_secret, access_token, access_secret
         FROM sns_accounts
         WHERE id IN (${selectedAccountIds.map(() => '?').join(',')}) AND is_active`,
        selectedAccountIds
      );

      snsResults = await postToMultipleSNS({
        title: lpContent.title,
        description: lpContent.subheadline,
        url: lpUrl,
        hashtags: body.keywords,
        targetAudience: body.targetAudience,
      }, accounts as any[], slug);
    }

    return NextResponse.json({
      success: true,
      slug,
      lpUrl,
      content: lpContent,
      snsResults,
    });
  } catch (error) {
    console.error('LP generation error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: 'Failed to generate LP content', detail: message },
      { status: 500 }
    );
  }
}