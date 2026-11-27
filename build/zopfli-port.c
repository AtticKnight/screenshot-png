#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include "zopfli/zopfli.h"

static unsigned char *last_output;

size_t compress_zlib(const unsigned char *input, size_t length, int iterations)
{
    ZopfliOptions options;
    size_t output_size = 0;
    free(last_output);
    last_output = NULL;
    ZopfliInitOptions(&options);
    options.numiterations = iterations;
    ZopfliCompress(&options, ZOPFLI_FORMAT_ZLIB, input, length, &last_output, &output_size);
    return output_size;
}

uintptr_t result_pointer(void)
{
    return (uintptr_t)last_output;
}
