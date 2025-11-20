import { NextRequest, NextResponse } from 'next/server';
import { validateAccessKey, createSession, setSessionCookie } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { accessKey } = body;

    if (!accessKey) {
      return NextResponse.json(
        { error: 'Access key is required' },
        { status: 400 }
      );
    }

    // Validate the access key
    const result = await validateAccessKey(accessKey);

    if (!result) {
      return NextResponse.json(
        { error: 'Invalid or expired access key' },
        { status: 401 }
      );
    }

    // Create a session
    const token = await createSession({
      companyId: result.companyId,
      companyName: result.companyName,
      accessKeyId: result.accessKeyId,
    });

    // Set the session cookie
    await setSessionCookie(token);

    return NextResponse.json({
      success: true,
      company: {
        id: result.companyId,
        name: result.companyName,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
