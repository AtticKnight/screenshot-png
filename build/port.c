#include <stddef.h>
#include <stdint.h>
#include "libdeflate.h"

#define INPUT_LIMIT (4u * 1024 * 1024)
#define ARENA_SIZE (64u * 1024 * 1024)
static unsigned char input[INPUT_LIMIT];
static unsigned char output[INPUT_LIMIT + 65536];
static unsigned char arena[ARENA_SIZE] __attribute__((aligned(16)));
static size_t used;
static struct libdeflate_compressor *compressor;

/* The library allocates its match finder when the single compressor is created.
 * It stays alive until the process finishes, so its arena never needs to shrink. */
static void *allocate(size_t bytes)
{
    size_t start = (used + 15u) & ~(size_t)15u;
    if (start > ARENA_SIZE || bytes > ARENA_SIZE - start)
        return NULL;
    used = start + bytes;
    return arena + start;
}

static void release(void *unused)
{
    (void)unused;
}

int prepare(int level)
{
    if (compressor != NULL)
        return 1;
    libdeflate_set_memory_allocator(allocate, release);
    compressor = libdeflate_alloc_compressor(level);
    return compressor != NULL;
}

uintptr_t input_pointer(void) { return (uintptr_t)input; }
uintptr_t output_pointer(void) { return (uintptr_t)output; }

size_t compress_image(size_t size)
{
    if (compressor == NULL || size > sizeof(input))
        return 0;
    return libdeflate_zlib_compress(compressor, input, size, output, sizeof(output));
}
