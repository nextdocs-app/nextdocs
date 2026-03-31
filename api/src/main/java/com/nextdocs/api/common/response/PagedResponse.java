package com.nextdocs.api.common.response;

import java.util.List;
import org.springframework.data.domain.Page;

public record PagedResponse<T>(
        List<T> content, long totalElements, int totalPages, int size, int number, boolean first, boolean last) {

    public static <T> PagedResponse<T> from(Page<T> page) {
        return new PagedResponse<>(
                page.getContent(),
                page.getTotalElements(),
                page.getTotalPages(),
                page.getSize(),
                page.getNumber(),
                page.isFirst(),
                page.isLast());
    }
}
