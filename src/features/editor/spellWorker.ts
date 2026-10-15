// The spelling dictionary, run off the window's thread (see spellCore.ts).
import { type Answer, Dictionary, type Request } from "./spellCore";

const dictionary = new Dictionary();

self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data;
  const answer: Answer = { id: request.id };
  try {
    if (request.type === "load") await dictionary.load(request.language, request.ownWords);
    else if (request.type === "check") answer.result = request.words.map((w) => dictionary.wrong(w));
    else answer.result = dictionary.suggest(request.word);
  } catch (e) {
    answer.error = String(e);
  }
  self.postMessage(answer);
};
