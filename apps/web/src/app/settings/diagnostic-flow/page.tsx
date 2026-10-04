import { redirect } from 'next/navigation';

export default function DiagnosticFlowRedirect() {
  redirect('/settings/communication-flows');
}
