export async function clearOPFS() {
  const root = await navigator.storage.getDirectory()
  for await (let handle of root.values()) {
    root.removeEntry(handle.name, { recursive: true })
  }
  console.log("OPFS cleared")
}
