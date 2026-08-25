export function profileUploadEvents(selectJson, generateCv) {
  function chooseFile(event) {
    void selectJson(event.target.files?.[0]); event.target.value = ''
  }
  function dropFile(event) {
    event.preventDefault(); void selectJson(event.dataTransfer?.files?.[0])
  }
  function chooseGenerationFile(event) {
    const file = event.target.files?.[0]
    if (file) void generateCv(file)
    event.target.value = ''
  }
  function dropGenerationFile(event) {
    event.preventDefault()
    const file = event.dataTransfer?.files?.[0]
    if (file) void generateCv(file)
  }
  return { chooseFile, chooseGenerationFile, dropFile, dropGenerationFile }
}
