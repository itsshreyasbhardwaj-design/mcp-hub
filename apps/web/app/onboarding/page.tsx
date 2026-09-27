import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { CreateOrganizationForm } from '@/components/create-organization-form';

export const metadata: Metadata = { title: 'Create an organization' };
export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect('/sign-in');
  if (session.principal.organizationId !== 'org_none') redirect('/');

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <h1 className="text-xl font-semibold tracking-tight text-fg-1">Create an organization</h1>
      <p className="mt-1 mb-6 text-sm text-fg-3">
        Every server, credential, permission rule and audit entry belongs to exactly one
        organization. You will be its owner.
      </p>
      <CreateOrganizationForm />
    </main>
  );
}
