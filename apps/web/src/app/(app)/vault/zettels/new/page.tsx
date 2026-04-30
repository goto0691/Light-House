import { redirect } from "next/navigation";

export default function NewZettelPage() {
  redirect("/vault/zettels?new=1");
}
