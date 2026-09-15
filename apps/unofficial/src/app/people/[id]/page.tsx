"use client";
import { useParams } from "next/navigation";
import PersonCard from "@/components/views/PersonCard";

export default function Page() {
  const params = useParams<{ id: string }>();
  return <PersonCard id={decodeURIComponent(params.id)} />;
}
