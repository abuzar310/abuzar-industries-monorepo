import DocListView from "@/components/views/DocListView";

export default function Page() {
  return (
    <DocListView
      store="quotations"
      title="Quotations"
      sub="all quotes"
      statusCol="Status"
      empty="No quotations yet."
      showNew
    />
  );
}
