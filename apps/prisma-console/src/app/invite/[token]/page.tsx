import InviteRedeemClient from "./invite-redeem-client";

export function generateStaticParams() {
  return [{ token: "_" }];
}

export default function InviteRedeemPage() {
  return <InviteRedeemClient />;
}
