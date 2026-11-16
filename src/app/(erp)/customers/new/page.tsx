import { Card, PageHeader } from "@/components/ui/page";
import { CustomerForm } from "@/components/forms/party-forms";

export const metadata = { title: "New customer" };

export default function NewCustomerPage() {
  return (
    <>
      <PageHeader title="New customer" crumbs={[{ href: "/customers", label: "Customers" }]} />
      <Card>
        <CustomerForm />
      </Card>
    </>
  );
}
