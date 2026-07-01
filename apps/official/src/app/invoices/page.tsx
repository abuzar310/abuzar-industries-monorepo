import DocListView from "@/components/views/DocListView";

export default function Page() {
  return (
    <DocListView
      store="invoices"
      title="Invoices"
      sub="billing & payments"
      statusCol="Payment"
      empty="No invoices yet."
      showNew
    />
  );
}
