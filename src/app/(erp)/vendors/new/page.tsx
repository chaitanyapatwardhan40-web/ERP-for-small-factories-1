import { Card, PageHeader } from "@/components/ui/page";
import { VendorForm } from "@/components/forms/party-forms";

export const metadata = { title: "New vendor" };

export default function NewVendorPage() {
  return (
    <>
      <PageHeader title="New vendor" crumbs={[{ href: "/vendors", label: "Vendors" }]} />
      <Card>
        <VendorForm />
      </Card>
    </>
  );
}
