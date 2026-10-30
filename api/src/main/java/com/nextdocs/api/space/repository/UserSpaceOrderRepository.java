package com.nextdocs.api.space.repository;

import com.nextdocs.api.space.entity.UserSpaceOrder;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

@Repository
public interface UserSpaceOrderRepository extends JpaRepository<UserSpaceOrder, UUID> {

    Optional<UserSpaceOrder> findByUser_IdAndSpace_Id(UUID userId, UUID spaceId);

    boolean existsByUser_IdAndOrderKey(UUID userId, String orderKey);

    @Modifying(flushAutomatically = true)
    @Query("DELETE FROM UserSpaceOrder uso WHERE uso.space.id = :spaceId")
    void deleteBySpace_Id(@Param("spaceId") UUID spaceId);

    @Query("SELECT MIN(uso.orderKey) FROM UserSpaceOrder uso WHERE uso.user.id = :userId")
    Optional<String> findMinOrderKeyByUserId(@Param("userId") UUID userId);

    @Query("SELECT MAX(uso.orderKey) FROM UserSpaceOrder uso "
            + "WHERE uso.user.id = :userId AND uso.space.id <> :excludeSpaceId")
    Optional<String> findMaxOrderKeyByUserId(
            @Param("userId") UUID userId, @Param("excludeSpaceId") UUID excludeSpaceId);

    @Query("SELECT MAX(uso.orderKey) FROM UserSpaceOrder uso "
            + "WHERE uso.user.id = :userId AND uso.space.id <> :excludeSpaceId AND uso.orderKey < :key")
    Optional<String> findMaxOrderKeyLessThan(
            @Param("userId") UUID userId, @Param("key") String key, @Param("excludeSpaceId") UUID excludeSpaceId);

    @Query("SELECT MIN(uso.orderKey) FROM UserSpaceOrder uso "
            + "WHERE uso.user.id = :userId AND uso.space.id <> :excludeSpaceId AND uso.orderKey > :key")
    Optional<String> findMinOrderKeyGreaterThan(
            @Param("userId") UUID userId, @Param("key") String key, @Param("excludeSpaceId") UUID excludeSpaceId);

    @Query("SELECT uso.orderKey FROM UserSpaceOrder uso " + "WHERE uso.user.id = :userId AND uso.space.id = :spaceId")
    Optional<String> findOrderKeyByUserIdAndSpaceId(@Param("userId") UUID userId, @Param("spaceId") UUID spaceId);

    @Query("SELECT uso.space.id, uso.orderKey FROM UserSpaceOrder uso "
            + "WHERE uso.user.id = :userId AND uso.space.id IN :spaceIds")
    List<Object[]> findOrderKeysByUserIdAndSpaceIds(
            @Param("userId") UUID userId, @Param("spaceIds") Collection<UUID> spaceIds);

    @Query("SELECT uso FROM UserSpaceOrder uso "
            + "WHERE uso.user.id = :userId "
            + "ORDER BY uso.orderKey ASC, uso.createdAt ASC, uso.id ASC")
    List<UserSpaceOrder> findAllForReindex(@Param("userId") UUID userId);
}
