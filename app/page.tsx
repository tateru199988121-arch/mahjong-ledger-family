import { homeMarkup } from "../lib/homeMarkup";

export default function Home() {
  return <div dangerouslySetInnerHTML={{ __html: homeMarkup }} />;
}
