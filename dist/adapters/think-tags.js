// Many OpenAI-compatible endpoints (Ollama, vLLM, llama.cpp, and hosted
// qwen/deepseek builds) have no reasoning field at all — they inline the
// model's thinking into delta.content wrapped in <think>…</think>. Benchy used
// to render that verbatim, so the tags and the whole train of thought showed up
// as part of the answer.
//
// Two things make this harder than a .replace():
//
//  1. The tag arrives split across SSE chunks — "<thi" then "nk>" — so the
//     parser has to hold state between calls and must not emit a partial tag as
//     answer text. It also must not withhold text forever: "<thing>" starts out
//     looking exactly like "<think>" and has to flush once it's disproven.
//
//  2. A tag is only reasoning when it OPENS the response. Otherwise asking a
//     model "explain the <think> tag" would make its answer silently vanish
//     into the reasoning block. These models always think first, so arming the
//     parser only until the first real answer text costs nothing and removes
//     the false positive.
const OPEN = '<think>';
const CLOSE = '</think>';
// Length of the longest suffix of `s` that is a proper prefix of `tag` — i.e.
// how many trailing chars might still turn out to be the start of a tag.
function partialTagSuffix(s, tag) {
    const max = Math.min(tag.length - 1, s.length);
    for (let k = max; k > 0; k--) {
        if (s.endsWith(tag.slice(0, k)))
            return k;
    }
    return 0;
}
export class ThinkTagParser {
    buf = '';
    inside = false;
    // Disarms once the model emits real answer text: from then on <think> is just
    // text the model chose to write, not a control tag.
    armed = true;
    push(text) {
        if (!this.armed)
            return text ? [{ type: 'token', text }] : [];
        const out = [];
        this.buf += text;
        for (;;) {
            // Disarmed mid-loop: everything still buffered is plain answer text and
            // must not be scanned for further tags.
            if (!this.armed)
                break;
            const tag = this.inside ? CLOSE : OPEN;
            const at = this.buf.indexOf(tag);
            if (at !== -1) {
                this.emit(out, this.buf.slice(0, at));
                // The text before an OPEN tag was real answer, so emit() just disarmed
                // us: this "<think>" is a literal the model wrote, not a control tag.
                // Drop the already-emitted prefix and leave the tag onward in the buffer
                // to be flushed as answer, unconsumed. (Only reachable when !inside — a
                // CLOSE search never disarms.)
                if (!this.armed) {
                    this.buf = this.buf.slice(at);
                    break;
                }
                this.buf = this.buf.slice(at + tag.length);
                this.inside = !this.inside;
                // A closed think block means the answer starts now; nothing later can
                // re-open one.
                if (!this.inside)
                    this.armed = false;
                continue;
            }
            const hold = partialTagSuffix(this.buf, tag);
            this.emit(out, this.buf.slice(0, this.buf.length - hold));
            this.buf = this.buf.slice(this.buf.length - hold);
            break;
        }
        if (!this.armed && this.buf) {
            out.push({ type: 'token', text: this.buf });
            this.buf = '';
        }
        return out;
    }
    // The stream ended: whatever is still held back is real content, including a
    // dangling "<thi" that never became a tag and an unclosed think block.
    flush() {
        if (!this.buf)
            return [];
        const text = this.buf;
        this.buf = '';
        return [{ type: this.inside ? 'reasoning' : 'token', text }];
    }
    emit(out, text) {
        if (!text)
            return;
        if (this.inside) {
            out.push({ type: 'reasoning', text });
            return;
        }
        out.push({ type: 'token', text });
        // Leading whitespace before <think> is not an answer — a model that emits
        // "\n<think>" must stay armed.
        if (text.trim())
            this.armed = false;
    }
}
