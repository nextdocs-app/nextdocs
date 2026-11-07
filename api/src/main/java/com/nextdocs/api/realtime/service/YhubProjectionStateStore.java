package com.nextdocs.api.realtime.service;

import com.nextdocs.api.realtime.entity.YhubProjectionState;
import com.nextdocs.api.realtime.repository.YhubProjectionStateRepository;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The transactional half of the projection job: a lease acquisition, the cursor read and
 * the compare-and-advance. Keeping these in their own bean makes each step a real
 * transaction instead of a self-invocation that Spring's proxy would skip.
 */
@Service
@RequiredArgsConstructor
public class YhubProjectionStateStore {

    private final YhubProjectionStateRepository repository;

    @Transactional
    public boolean tryAcquire(UUID owner, Duration lease) {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        // The singleton row is seeded by V42. Inserting it defensively here would share this
        // transaction: a duplicate-key failure on a second instance aborts it on Postgres,
        // and the lease statement below would fail with it.
        return repository.tryAcquire(owner, now, now.plus(lease)) == 1;
    }

    @Transactional(readOnly = true)
    public long cursor() {
        return repository
                .findById(YhubProjectionState.SINGLETON_ID)
                .map(YhubProjectionState::getCursor)
                .orElse(0L);
    }

    /** Returns false when the lease was lost, so the caller must not claim progress. */
    @Transactional
    public boolean advance(UUID owner, long cursor) {
        return repository.advance(owner, cursor, OffsetDateTime.now(ZoneOffset.UTC)) == 1;
    }

    @Transactional
    public void release(UUID owner) {
        repository.release(owner);
    }
}
