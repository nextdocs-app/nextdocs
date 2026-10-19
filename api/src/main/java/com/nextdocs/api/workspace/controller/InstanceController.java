package com.nextdocs.api.workspace.controller;

import com.nextdocs.api.common.response.ApiResponse;
import com.nextdocs.api.workspace.dto.response.InstanceStatusResponse;
import com.nextdocs.api.workspace.service.WorkspaceAccessService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "Instance", description = "Public instance status for the auth screens")
@RestController
@RequestMapping(InstanceController.PATH)
@RequiredArgsConstructor
public class InstanceController {

    /** Route shape, exposed so tests and the security config reference the real string. */
    public static final String PATH = "/api/v1/instance";

    public static final String STATUS_PATH = PATH + "/status";

    private final WorkspaceAccessService accessService;

    @Operation(
            summary = "Get public instance status",
            description = "Whether the instance has been initialized (a workspace member exists). The "
                    + "first account registers without an invite; afterwards registration is invite-only. "
                    + "Public.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Status returned"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "429",
                        description = "Too many requests")
            })
    @GetMapping("/status")
    public ResponseEntity<ApiResponse<InstanceStatusResponse>> status() {
        return ResponseEntity.ok(ApiResponse.ok(new InstanceStatusResponse(accessService.isInitialized())));
    }
}
