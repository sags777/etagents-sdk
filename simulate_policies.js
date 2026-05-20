const chunks = ['To create', ' a ticket', ' for building', ' the landing website', ',', ' we need to define', ' the scope', ' clearly', '.', ' ', 'Here', '\'s', ' a proposed', ' PRD', ':', '\n\n', '### Goal\n', 'To create a professional and engaging landing', ' website', ' for Everything agents', '.'];
const spacing = 40;

async function simulateOldPolicy(chunks) {
    let buffer = '';
    let frames = [];
    let timer = null;

    const flush = (reason) => {
        if (buffer) {
            frames.push({ content: buffer, reason });
            buffer = '';
        }
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    };

    for (const chunk of chunks) {
        buffer += chunk;
        
        // Policy: flush on /[\s.,!?]$/
        if (/[\s.,!?]$/.test(chunk)) {
            flush('regex');
        } else if (!timer) {
            // First timer: 50ms
            timer = setTimeout(() => flush('timer'), 50);
        }
        
        await new Promise(r => setTimeout(r, spacing));
    }
    flush('end');
    return frames;
}

async function simulateNewPolicy(chunks) {
    let buffer = '';
    let frames = [];
    let timer = null;
    const minChars = 20; // Example minChars
    const maxChars = 512;
    const trailingTimer = 150;

    const flush = (reason) => {
        if (buffer) {
            frames.push({ content: buffer, reason });
            buffer = '';
        }
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    };

    const isBoundary = (chunk) => {
        return /[.!?]\s*$/.test(chunk) || chunk.includes('\n');
    };

    for (const chunk of chunks) {
        buffer += chunk;

        if (buffer.length >= maxChars) {
            flush('max_chars');
        } else if (isBoundary(chunk) && buffer.length >= minChars) {
            flush('boundary');
        } else {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => flush('trailing_timer'), trailingTimer);
        }

        await new Promise(r => setTimeout(r, spacing));
    }
    flush('end');
    return frames;
}

async function run() {
    const oldFrames = await simulateOldPolicy(chunks);
    const newFrames = await simulateNewPolicy(chunks);

    console.log('--- Old Policy ---');
    console.log('Frame count:', oldFrames.length);
    console.log('First 5 frames:', JSON.stringify(oldFrames.slice(0, 5), null, 2));

    console.log('\n--- New Policy ---');
    console.log('Frame count:', newFrames.length);
    console.log('First 5 frames:', JSON.stringify(newFrames.slice(0, 5), null, 2));
}

run();
