<?php

if (!defined('ABSPATH')) {
    exit;
}

class RP_API
{
    const OPTION_PAIRED_CLIENTS = 'rp_paired_clients';
    const OPTION_PAIR_REQUESTS = 'rp_pair_requests';
    const OPTION_PUBLISH_MAPS = 'rp_publish_maps';
    const PUBLISH_AUTH_MAX_SKEW = 300;

    /** @var RP_Plugin */
    private $plugin;

    public function __construct($plugin)
    {
        $this->plugin = $plugin;
        add_action('rest_api_init', array($this, 'register_routes'));
    }

    public function register_routes()
    {
        register_rest_route('revelation/v1', '/pair/challenge', array(
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => array($this, 'issue_pairing_challenge'),
            'permission_callback' => '__return_true',
        ));

        register_rest_route('revelation/v1', '/pair', array(
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => array($this, 'create_pairing_request'),
            'permission_callback' => '__return_true',
        ));

        register_rest_route('revelation/v1', '/pair/status', array(
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => array($this, 'pairing_status'),
            'permission_callback' => '__return_true',
        ));

        register_rest_route('revelation/v1', '/publish/check', array(
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => array($this, 'publish_check'),
            'permission_callback' => '__return_true',
        ));

        register_rest_route('revelation/v1', '/publish/file', array(
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => array($this, 'publish_file'),
            'permission_callback' => '__return_true',
        ));

        register_rest_route('revelation/v1', '/publish/commit', array(
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => array($this, 'publish_commit'),
            'permission_callback' => '__return_true',
        ));

        register_rest_route('revelation/v1', '/media-sync/check', array(
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => array($this, 'media_sync_check'),
            'permission_callback' => '__return_true',
        ));

        register_rest_route('revelation/v1', '/media-sync/file', array(
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => array($this, 'media_sync_file'),
            'permission_callback' => '__return_true',
        ));

        register_rest_route('revelation/v1', '/media-sync/commit', array(
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => array($this, 'media_sync_commit'),
            'permission_callback' => '__return_true',
        ));
    }

    public function issue_pairing_challenge($request)
    {
        $challenge = $this->generate_challenge();
        $challenge_key = 'rp_pair_challenge_' . md5($challenge);
        set_transient($challenge_key, array(
            'created_at' => time(),
            'request_ip' => $this->get_request_ip(),
        ), 5 * MINUTE_IN_SECONDS);

        return new WP_REST_Response(array(
            'challenge' => $challenge,
            'expiresInSeconds' => 300,
            'siteName' => get_bloginfo('name'),
            'siteUrl' => home_url('/'),
        ), 200);
    }

    public function create_pairing_request($request)
    {
        $params = $request->get_json_params();
        if (!is_array($params)) {
            $params = array();
        }

        $auth = isset($params['auth']) && is_array($params['auth']) ? $params['auth'] : array();
        $method = isset($auth['method']) ? sanitize_key($auth['method']) : '';
        if ($method !== 'rsa') {
            return new WP_REST_Response(array('message' => 'Only RSA auth method is enabled.'), 400);
        }

        $challenge = isset($auth['challenge']) ? sanitize_text_field((string) $auth['challenge']) : '';
        $signature = isset($auth['signature']) ? (string) $auth['signature'] : '';
        $public_key = isset($auth['publicKey']) ? trim((string) $auth['publicKey']) : '';

        if ($challenge === '' || $signature === '' || $public_key === '') {
            return new WP_REST_Response(array('message' => 'RSA pairing requires challenge, signature, and public key.'), 400);
        }

        $challenge_key = 'rp_pair_challenge_' . md5($challenge);
        $challenge_data = get_transient($challenge_key);
        if (!is_array($challenge_data)) {
            return new WP_REST_Response(array('message' => 'Pairing challenge expired or invalid.'), 400);
        }
        delete_transient($challenge_key);

        if (!$this->verify_signature($public_key, $challenge, $signature)) {
            return new WP_REST_Response(array('message' => 'RSA signature verification failed.'), 403);
        }

        $client = isset($params['client']) && is_array($params['client']) ? $params['client'] : array();
        $client_instance_id = isset($client['appInstanceId']) ? sanitize_text_field((string) $client['appInstanceId']) : '';
        $client_name = isset($client['appName']) ? sanitize_text_field((string) $client['appName']) : '';
        $client_version = isset($client['appVersion']) ? sanitize_text_field((string) $client['appVersion']) : '';
        $claimed_hostname = isset($client['claimedHostname']) ? sanitize_text_field((string) $client['claimedHostname']) : '';

        $request_id = wp_generate_uuid4();
        $one_time_code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        $now_iso = gmdate('c');

        $pending = array(
            'request_id' => $request_id,
            'status' => 'pending',
            'created_at' => $now_iso,
            'updated_at' => $now_iso,
            'request_ip' => $this->get_request_ip(),
            'one_time_code' => $one_time_code,
            'method' => 'rsa',
            'client_instance_id' => $client_instance_id,
            'client_name' => $client_name,
            'client_version' => $client_version,
            'claimed_hostname' => $claimed_hostname,
            'client_public_key' => $public_key,
            'client_public_key_fingerprint' => hash('sha256', $public_key),
            'site_url' => home_url('/'),
            'site_name' => get_bloginfo('name'),
            'pairing_id' => '',
            'publish_token' => '',
            'publish_endpoint' => '',
            'approved_at' => '',
            'rejected_at' => '',
        );

        $this->upsert_pair_request($pending);

        return new WP_REST_Response(array(
            'pending' => true,
            'pairingRequestId' => $request_id,
            'oneTimeCode' => $one_time_code,
            'message' => 'Pairing request created. Confirm this request in WordPress settings.',
            'siteName' => get_bloginfo('name'),
            'siteUrl' => home_url('/'),
            'supportedAuthMode' => 'rsa',
        ), 200);
    }

    public function pairing_status($request)
    {
        $params = $request->get_json_params();
        if (!is_array($params)) {
            $params = array();
        }

        $request_id = isset($params['pairingRequestId']) ? sanitize_text_field((string) $params['pairingRequestId']) : '';
        if ($request_id === '') {
            return new WP_REST_Response(array('message' => 'pairingRequestId is required.'), 400);
        }

        $pair_request = $this->find_pair_request($request_id);
        if (!$pair_request) {
            return new WP_REST_Response(array('message' => 'Pairing request not found.'), 404);
        }

        $auth = isset($params['auth']) && is_array($params['auth']) ? $params['auth'] : array();
        $method = isset($auth['method']) ? sanitize_key($auth['method']) : '';
        if ($method !== 'rsa') {
            return new WP_REST_Response(array('message' => 'Only RSA auth method is enabled.'), 400);
        }
        $signature = isset($auth['signature']) ? (string) $auth['signature'] : '';
        $public_key = isset($auth['publicKey']) ? trim((string) $auth['publicKey']) : '';

        if ($signature === '' || $public_key === '') {
            return new WP_REST_Response(array('message' => 'RSA status check requires signature and public key.'), 400);
        }

        $stored_public = isset($pair_request['client_public_key']) ? (string) $pair_request['client_public_key'] : '';
        if ($stored_public === '' || !hash_equals($stored_public, $public_key)) {
            return new WP_REST_Response(array('message' => 'Public key does not match pairing request.'), 403);
        }

        if (!$this->verify_signature($public_key, $request_id, $signature)) {
            return new WP_REST_Response(array('message' => 'RSA signature verification failed.'), 403);
        }

        $status = isset($pair_request['status']) ? (string) $pair_request['status'] : 'pending';
        if ($status === 'approved') {
            return new WP_REST_Response(array(
                'paired' => true,
                'status' => 'approved',
                'pairingId' => (string) ($pair_request['pairing_id'] ?? ''),
                'siteName' => (string) ($pair_request['site_name'] ?? get_bloginfo('name')),
                'siteUrl' => (string) ($pair_request['site_url'] ?? home_url('/')),
                'publishEndpoint' => (string) ($pair_request['publish_endpoint'] ?? rest_url('revelation/v1/publish')),
                'publishToken' => (string) ($pair_request['publish_token'] ?? ''),
                'supportedAuthMode' => 'rsa',
            ), 200);
        }

        if ($status === 'rejected') {
            return new WP_REST_Response(array(
                'rejected' => true,
                'status' => 'rejected',
                'message' => 'Pairing request was rejected by a WordPress administrator.',
            ), 200);
        }

        return new WP_REST_Response(array(
            'pending' => true,
            'status' => 'pending',
            'message' => 'Awaiting WordPress administrator approval.',
        ), 200);
    }

    public function publish_check($request)
    {
        $payload = $this->get_json_payload($request);
        $auth = $this->authenticate_publish_client($payload, 'publish-check');
        if (is_wp_error($auth)) {
            return new WP_REST_Response(array('message' => $auth->get_error_message()), 403);
        }

        $local_slug = $this->sanitize_local_slug(isset($payload['localSlug']) ? $payload['localSlug'] : '');
        if ($local_slug === '') {
            return new WP_REST_Response(array('message' => 'localSlug is required.'), 400);
        }

        $manifest = $this->sanitize_manifest(isset($payload['manifest']) ? $payload['manifest'] : array());
        if (is_wp_error($manifest)) {
            return new WP_REST_Response(array('message' => $manifest->get_error_message()), 400);
        }

        $remote_slug = $this->resolve_remote_slug($auth, $local_slug);
        $remote_dir = $this->plugin->storage->presentation_dir($remote_slug);
        if (!$remote_dir) {
            return new WP_REST_Response(array('message' => 'Failed to resolve remote slug.'), 500);
        }

        $server_manifest = $this->read_server_manifest($remote_dir);
        $server_files_map = $this->manifest_files_map($server_manifest);
        $client_files = isset($manifest['files']) && is_array($manifest['files']) ? $manifest['files'] : array();

        $needed = array();
        foreach ($client_files as $file_item) {
            $filename = (string) ($file_item['filename'] ?? '');
            $client_modified = (string) ($file_item['modified'] ?? '');
            if ($filename === '') {
                continue;
            }
            $server_file_path = $this->safe_join_existing_or_future($remote_dir, $filename);
            $server_has_file = $server_file_path && is_file($server_file_path);
            if (!isset($server_files_map[$filename])) {
                $needed[] = array('filename' => $filename, 'modified' => $client_modified);
                continue;
            }
            if (!$server_has_file) {
                $needed[] = array('filename' => $filename, 'modified' => $client_modified);
                continue;
            }
            $server_modified = (string) ($server_files_map[$filename]['modified'] ?? '');
            if ($this->iso_to_timestamp($client_modified) > $this->iso_to_timestamp($server_modified)) {
                $needed[] = array('filename' => $filename, 'modified' => $client_modified);
            }
        }

        return new WP_REST_Response(array(
            'ok' => true,
            'remoteSlug' => $remote_slug,
            'neededFiles' => $needed,
            'serverFileCount' => count($server_files_map),
            'serverMaxUploadRequestBytes' => $this->detect_server_max_publish_request_bytes(),
        ), 200);
    }

    public function publish_file($request)
    {
        $payload = $this->get_json_payload($request);
        $auth = $this->authenticate_publish_client($payload, 'publish-file', array('contentBase64'));
        if (is_wp_error($auth)) {
            return new WP_REST_Response(array('message' => $auth->get_error_message()), 403);
        }

        $local_slug = $this->sanitize_local_slug(isset($payload['localSlug']) ? $payload['localSlug'] : '');
        if ($local_slug === '') {
            return new WP_REST_Response(array('message' => 'localSlug is required.'), 400);
        }

        $remote_slug = $this->resolve_remote_slug($auth, $local_slug);
        $expected_remote_slug = isset($payload['remoteSlug']) ? $this->plugin->storage->sanitize_slug($payload['remoteSlug']) : '';
        if ($expected_remote_slug && $expected_remote_slug !== $remote_slug) {
            return new WP_REST_Response(array('message' => 'remoteSlug mismatch for this pairing/localSlug mapping.'), 409);
        }

        $filename = $this->sanitize_publish_filename(isset($payload['filename']) ? $payload['filename'] : '');
        if ($filename === '') {
            return new WP_REST_Response(array('message' => 'filename is required.'), 400);
        }

        if (!$this->is_publish_file_allowed($filename)) {
            return new WP_REST_Response(array('message' => 'File type/path is not allowed for publish.'), 400);
        }

        $chunk_info = $this->sanitize_chunk_info($payload);
        if (is_wp_error($chunk_info)) {
            return new WP_REST_Response(array('message' => $chunk_info->get_error_message()), 400);
        }

        $content_base64 = isset($payload['contentBase64']) ? (string) $payload['contentBase64'] : '';
        $decoded = base64_decode($content_base64, true);
        if ($decoded === false) {
            return new WP_REST_Response(array('message' => 'Invalid contentBase64.'), 400);
        }

        $remote_dir = $this->plugin->storage->presentation_dir($remote_slug);
        if (!$remote_dir) {
            return new WP_REST_Response(array('message' => 'Failed to resolve destination.'), 500);
        }
        if (!is_dir($remote_dir) && !wp_mkdir_p($remote_dir)) {
            return new WP_REST_Response(array('message' => 'Failed to create destination directory.'), 500);
        }

        $abs_path = $this->safe_join_existing_or_future($remote_dir, $filename);
        if (!$abs_path) {
            return new WP_REST_Response(array('message' => 'Unsafe filename path.'), 400);
        }

        $parent = dirname($abs_path);
        if (!is_dir($parent) && !wp_mkdir_p($parent)) {
            return new WP_REST_Response(array('message' => 'Failed to create destination folder.'), 500);
        }

        $write_result = $this->write_chunked_file($abs_path, $decoded, $chunk_info, array(
            'scope' => 'publish',
            'pairing_id' => (string) ($auth['pairing_id'] ?? ''),
            'filename' => $filename,
            'remote_slug' => $remote_slug,
        ));
        if (is_wp_error($write_result)) {
            return new WP_REST_Response(array('message' => $write_result->get_error_message()), 500);
        }

        if (!empty($write_result['complete'])) {
            $modified = isset($payload['modified']) ? (string) $payload['modified'] : '';
            $ts = $this->iso_to_timestamp($modified);
            if ($ts > 0) {
                @touch($abs_path, $ts);
            }
        }

        return new WP_REST_Response(array(
            'ok' => true,
            'remoteSlug' => $remote_slug,
            'filename' => $filename,
            'chunkIndex' => intval($chunk_info['chunkIndex']),
            'totalChunks' => intval($chunk_info['totalChunks']),
            'complete' => !empty($write_result['complete']),
        ), 200);
    }

    public function publish_commit($request)
    {
        $payload = $this->get_json_payload($request);
        $auth = $this->authenticate_publish_client($payload, 'publish-commit');
        if (is_wp_error($auth)) {
            return new WP_REST_Response(array('message' => $auth->get_error_message()), 403);
        }

        $local_slug = $this->sanitize_local_slug(isset($payload['localSlug']) ? $payload['localSlug'] : '');
        if ($local_slug === '') {
            return new WP_REST_Response(array('message' => 'localSlug is required.'), 400);
        }

        $manifest = $this->sanitize_manifest(isset($payload['manifest']) ? $payload['manifest'] : array());
        if (is_wp_error($manifest)) {
            return new WP_REST_Response(array('message' => $manifest->get_error_message()), 400);
        }

        $remote_slug = $this->resolve_remote_slug($auth, $local_slug);
        $expected_remote_slug = isset($payload['remoteSlug']) ? $this->plugin->storage->sanitize_slug($payload['remoteSlug']) : '';
        if ($expected_remote_slug && $expected_remote_slug !== $remote_slug) {
            return new WP_REST_Response(array('message' => 'remoteSlug mismatch for this pairing/localSlug mapping.'), 409);
        }

        $remote_dir = $this->plugin->storage->presentation_dir($remote_slug);
        if (!$remote_dir) {
            return new WP_REST_Response(array('message' => 'Failed to resolve destination.'), 500);
        }
        if (!is_dir($remote_dir) && !wp_mkdir_p($remote_dir)) {
            return new WP_REST_Response(array('message' => 'Failed to create destination directory.'), 500);
        }

        $manifest_path = $this->safe_join_existing_or_future($remote_dir, 'manifest.json');
        if (!$manifest_path) {
            return new WP_REST_Response(array('message' => 'Failed to write manifest.'), 500);
        }
        file_put_contents($manifest_path, wp_json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

        $this->plugin->storage->ensure_runtime_assets_for_slug($remote_slug);

        $md_files = $this->plugin->storage->collect_markdown_files($remote_dir);
        $title = $remote_slug;
        if (!empty($md_files)) {
            $maybe_title = $this->plugin->storage->extract_title_from_markdown($remote_dir, $md_files[0]);
            if (is_string($maybe_title) && $maybe_title !== '') {
                $title = $maybe_title;
            }
        }

        $this->plugin->storage->upsert_index(array(
            'slug' => $remote_slug,
            'title' => $title,
            'folder_name' => $remote_slug,
            'source_zip' => 'wordpress_publish_api',
            'presentation_count' => count($md_files),
        ));

        return new WP_REST_Response(array(
            'ok' => true,
            'remoteSlug' => $remote_slug,
            'siteName' => get_bloginfo('name'),
            'siteUrl' => home_url('/'),
            'presentationUrl' => add_query_arg('p', !empty($md_files) ? $md_files[0] : 'presentation.md', trailingslashit(home_url('/_revelation/' . $remote_slug))),
        ), 200);
    }

    public function media_sync_check($request)
    {
        $payload = $this->get_json_payload($request);
        $auth = $this->authenticate_publish_client($payload, 'media-sync-check');
        if (is_wp_error($auth)) {
            return new WP_REST_Response(array('message' => $auth->get_error_message()), 403);
        }

        $manifest = $this->sanitize_media_manifest(isset($payload['manifest']) ? $payload['manifest'] : array());
        if (is_wp_error($manifest)) {
            return new WP_REST_Response(array('message' => $manifest->get_error_message()), 400);
        }

        $media_dir = $this->plugin->storage->shared_media_dir();
        $server_manifest = $this->read_media_server_manifest($media_dir);
        $server_files_map = $this->manifest_files_map($server_manifest);
        $client_files = isset($manifest['files']) && is_array($manifest['files']) ? $manifest['files'] : array();
        $needed = array();

        foreach ($client_files as $file_item) {
            $filename = (string) ($file_item['filename'] ?? '');
            $client_modified = (string) ($file_item['modified'] ?? '');
            if ($filename === '') {
                continue;
            }
            $server_file_path = $this->safe_join_existing_or_future($media_dir, $filename);
            $server_has_file = $server_file_path && is_file($server_file_path);
            if (!isset($server_files_map[$filename]) || !$server_has_file) {
                $needed[] = array('filename' => $filename, 'modified' => $client_modified);
                continue;
            }
            $server_modified = (string) ($server_files_map[$filename]['modified'] ?? '');
            if ($this->iso_to_timestamp($client_modified) > $this->iso_to_timestamp($server_modified)) {
                $needed[] = array('filename' => $filename, 'modified' => $client_modified);
            }
        }

        return new WP_REST_Response(array(
            'ok' => true,
            'neededFiles' => $needed,
            'serverFileCount' => count($server_files_map),
            'serverIndexUrl' => trailingslashit($this->plugin->storage->shared_media_url()) . 'index.json',
            'serverMaxUploadRequestBytes' => $this->detect_server_max_publish_request_bytes(),
        ), 200);
    }

    public function media_sync_file($request)
    {
        $payload = $this->get_json_payload($request);
        $auth = $this->authenticate_publish_client($payload, 'media-sync-file', array('contentBase64'));
        if (is_wp_error($auth)) {
            return new WP_REST_Response(array('message' => $auth->get_error_message()), 403);
        }

        $filename = $this->sanitize_media_sync_filename(isset($payload['filename']) ? $payload['filename'] : '');
        if ($filename === '') {
            return new WP_REST_Response(array('message' => 'filename is required.'), 400);
        }

        if (!$this->is_media_sync_file_allowed($filename)) {
            return new WP_REST_Response(array('message' => 'File type/path is not allowed for shared media sync.'), 400);
        }

        $chunk_info = $this->sanitize_chunk_info($payload);
        if (is_wp_error($chunk_info)) {
            return new WP_REST_Response(array('message' => $chunk_info->get_error_message()), 400);
        }

        $content_base64 = isset($payload['contentBase64']) ? (string) $payload['contentBase64'] : '';
        $decoded = base64_decode($content_base64, true);
        if ($decoded === false) {
            return new WP_REST_Response(array('message' => 'Invalid contentBase64.'), 400);
        }

        $media_dir = $this->plugin->storage->shared_media_dir();
        if (!is_dir($media_dir) && !wp_mkdir_p($media_dir)) {
            return new WP_REST_Response(array('message' => 'Failed to create shared media directory.'), 500);
        }

        $abs_path = $this->safe_join_existing_or_future($media_dir, $filename);
        if (!$abs_path) {
            return new WP_REST_Response(array('message' => 'Unsafe filename path.'), 400);
        }

        $parent = dirname($abs_path);
        if (!is_dir($parent) && !wp_mkdir_p($parent)) {
            return new WP_REST_Response(array('message' => 'Failed to create destination folder.'), 500);
        }

        $write_result = $this->write_chunked_file($abs_path, $decoded, $chunk_info, array(
            'scope' => 'media-sync',
            'pairing_id' => (string) ($auth['pairing_id'] ?? ''),
            'filename' => $filename,
        ));
        if (is_wp_error($write_result)) {
            return new WP_REST_Response(array('message' => $write_result->get_error_message()), 500);
        }

        if (!empty($write_result['complete'])) {
            $modified = isset($payload['modified']) ? (string) $payload['modified'] : '';
            $ts = $this->iso_to_timestamp($modified);
            if ($ts > 0) {
                @touch($abs_path, $ts);
            }
        }

        return new WP_REST_Response(array(
            'ok' => true,
            'filename' => $filename,
            'chunkIndex' => intval($chunk_info['chunkIndex']),
            'totalChunks' => intval($chunk_info['totalChunks']),
            'complete' => !empty($write_result['complete']),
        ), 200);
    }

    public function media_sync_commit($request)
    {
        $payload = $this->get_json_payload($request);
        $auth = $this->authenticate_publish_client($payload, 'media-sync-commit');
        if (is_wp_error($auth)) {
            return new WP_REST_Response(array('message' => $auth->get_error_message()), 403);
        }

        $manifest = $this->sanitize_media_manifest(isset($payload['manifest']) ? $payload['manifest'] : array());
        if (is_wp_error($manifest)) {
            return new WP_REST_Response(array('message' => $manifest->get_error_message()), 400);
        }

        $media_dir = $this->plugin->storage->shared_media_dir();
        if (!is_dir($media_dir) && !wp_mkdir_p($media_dir)) {
            return new WP_REST_Response(array('message' => 'Failed to create shared media directory.'), 500);
        }

        $manifest_path = $this->safe_join_existing_or_future($media_dir, 'manifest.json');
        if (!$manifest_path) {
            return new WP_REST_Response(array('message' => 'Failed to write shared media manifest.'), 500);
        }
        file_put_contents($manifest_path, wp_json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

        $allowed_files = array();
        $files = isset($manifest['files']) && is_array($manifest['files']) ? $manifest['files'] : array();
        foreach ($files as $item) {
            if (!is_array($item)) {
                continue;
            }
            $filename = $this->sanitize_media_sync_filename(isset($item['filename']) ? $item['filename'] : '');
            if ($filename !== '') {
                $allowed_files[$filename] = true;
            }
        }
        $allowed_files['manifest.json'] = true;

        $existing_entries = @scandir($media_dir);
        if (is_array($existing_entries)) {
            foreach ($existing_entries as $entry) {
                if ($entry === '.' || $entry === '..') {
                    continue;
                }
                $entry_name = $this->sanitize_media_sync_filename($entry);
                if ($entry_name === '' || isset($allowed_files[$entry_name])) {
                    continue;
                }
                $entry_path = $this->safe_join_existing_or_future($media_dir, $entry_name);
                if ($entry_path && is_file($entry_path)) {
                    @unlink($entry_path);
                }
            }
        }

        return new WP_REST_Response(array(
            'ok' => true,
            'siteName' => get_bloginfo('name'),
            'siteUrl' => home_url('/'),
            'sharedMediaUrl' => trailingslashit($this->plugin->storage->shared_media_url()),
            'sharedMediaIndexUrl' => trailingslashit($this->plugin->storage->shared_media_url()) . 'index.json',
            'fileCount' => count($files),
        ), 200);
    }

    public function list_pair_requests()
    {
        $items = get_option(self::OPTION_PAIR_REQUESTS, array());
        return is_array($items) ? $items : array();
    }

    public function list_paired_clients()
    {
        $items = get_option(self::OPTION_PAIRED_CLIENTS, array());
        return is_array($items) ? $items : array();
    }

    public function approve_pair_request($request_id)
    {
        $request_id = sanitize_text_field((string) $request_id);
        if ($request_id === '') {
            return new WP_Error('invalid_request_id', 'Invalid pairing request ID.');
        }

        $requests = $this->list_pair_requests();
        $found = false;
        foreach ($requests as $idx => $item) {
            if (($item['request_id'] ?? '') !== $request_id) {
                continue;
            }
            $found = true;
            if (($item['status'] ?? '') !== 'pending') {
                return true;
            }
            $pairing_id = wp_generate_uuid4();
            $publish_token = wp_generate_password(32, false, false);
            $now_iso = gmdate('c');
            $item['status'] = 'approved';
            $item['updated_at'] = $now_iso;
            $item['approved_at'] = $now_iso;
            $item['pairing_id'] = $pairing_id;
            $item['publish_token'] = $publish_token;
            $item['publish_endpoint'] = rest_url('revelation/v1/publish');
            $requests[$idx] = $item;
            $this->upsert_paired_client($item);
            break;
        }

        if (!$found) {
            return new WP_Error('not_found', 'Pairing request not found.');
        }

        update_option(self::OPTION_PAIR_REQUESTS, array_values($requests), false);
        return true;
    }

    public function reject_pair_request($request_id)
    {
        $request_id = sanitize_text_field((string) $request_id);
        if ($request_id === '') {
            return new WP_Error('invalid_request_id', 'Invalid pairing request ID.');
        }

        $requests = $this->list_pair_requests();
        $found = false;
        foreach ($requests as $idx => $item) {
            if (($item['request_id'] ?? '') !== $request_id) {
                continue;
            }
            $found = true;
            $item['status'] = 'rejected';
            $item['updated_at'] = gmdate('c');
            $item['rejected_at'] = gmdate('c');
            $requests[$idx] = $item;
            break;
        }

        if (!$found) {
            return new WP_Error('not_found', 'Pairing request not found.');
        }

        update_option(self::OPTION_PAIR_REQUESTS, array_values($requests), false);
        return true;
    }

    public function delete_paired_client($pairing_id)
    {
        $pairing_id = sanitize_text_field((string) $pairing_id);
        if ($pairing_id === '') {
            return new WP_Error('invalid_pairing_id', 'Invalid pairing ID.');
        }

        $items = $this->list_paired_clients();
        $next = array_values(array_filter($items, function ($item) use ($pairing_id) {
            return (string) ($item['pairing_id'] ?? '') !== $pairing_id;
        }));

        if (count($next) === count($items)) {
            return new WP_Error('not_found', 'Paired client not found.');
        }

        update_option(self::OPTION_PAIRED_CLIENTS, $next, false);

        $maps = $this->list_publish_maps();
        $maps_next = array_values(array_filter($maps, function ($item) use ($pairing_id) {
            return (string) ($item['pairing_id'] ?? '') !== $pairing_id;
        }));
        if (count($maps_next) !== count($maps)) {
            update_option(self::OPTION_PUBLISH_MAPS, $maps_next, false);
        }

        return true;
    }

    private function get_json_payload($request)
    {
        $payload = $request->get_json_params();
        return is_array($payload) ? $payload : array();
    }

    private function authenticate_publish_client($payload, $action, $unsigned_exclude_fields = array())
    {
        $pairing_id = sanitize_text_field((string) ($payload['pairingId'] ?? ''));
        $publish_token = (string) ($payload['publishToken'] ?? '');
        if ($pairing_id === '' || $publish_token === '') {
            return new WP_Error('missing_credentials', 'pairingId and publishToken are required.');
        }

        $client = $this->find_paired_client($pairing_id);
        if (!$client) {
            return new WP_Error('unknown_pairing', 'Unknown pairing ID.');
        }

        $stored_token = (string) ($client['publish_token'] ?? '');
        if ($stored_token === '' || !hash_equals($stored_token, $publish_token)) {
            return new WP_Error('invalid_token', 'Invalid publish token.');
        }

        $auth = isset($payload['auth']) && is_array($payload['auth']) ? $payload['auth'] : array();
        $method = isset($auth['method']) ? sanitize_key($auth['method']) : '';
        if ($method !== 'rsa') {
            return new WP_Error('invalid_auth_method', 'Publish requests require RSA request signing.');
        }

        $timestamp = isset($auth['timestamp']) ? sanitize_text_field((string) $auth['timestamp']) : '';
        $nonce = isset($auth['nonce']) ? sanitize_text_field((string) $auth['nonce']) : '';
        $payload_hash = isset($auth['payloadHash']) ? sanitize_text_field((string) $auth['payloadHash']) : '';
        $signature = isset($auth['signature']) ? (string) $auth['signature'] : '';
        $public_key = isset($auth['publicKey']) ? trim((string) $auth['publicKey']) : '';
        if ($timestamp === '' || $nonce === '' || $payload_hash === '' || $signature === '' || $public_key === '') {
            return new WP_Error('missing_auth_fields', 'Signed publish requests require timestamp, nonce, payloadHash, signature, and publicKey.');
        }

        $stored_public_key = (string) ($client['client_public_key'] ?? '');
        if ($stored_public_key === '' || !hash_equals($stored_public_key, $public_key)) {
            return new WP_Error('invalid_public_key', 'Public key does not match the paired client.');
        }

        $ts = strtotime($timestamp);
        if (!$ts) {
            return new WP_Error('invalid_timestamp', 'Publish request timestamp is invalid.');
        }
        if (abs(time() - (int) $ts) > self::PUBLISH_AUTH_MAX_SKEW) {
            return new WP_Error('expired_timestamp', 'Publish request timestamp is outside the allowed window.');
        }

        if (!preg_match('/^[a-f0-9]{32,128}$/i', $nonce)) {
            return new WP_Error('invalid_nonce', 'Publish request nonce format is invalid.');
        }

        $nonce_key = 'rp_pub_nonce_' . hash('sha256', $pairing_id . '|' . $nonce);
        if (get_transient($nonce_key)) {
            return new WP_Error('replayed_nonce', 'Publish request nonce has already been used.');
        }

        $unsigned_payload = $payload;
        unset($unsigned_payload['auth']);
        if (is_array($unsigned_exclude_fields)) {
            foreach ($unsigned_exclude_fields as $field) {
                if (is_string($field) && $field !== '') {
                    unset($unsigned_payload[$field]);
                }
            }
        }
        $expected_payload_hash = rtrim(strtr(base64_encode(hash('sha256', $this->canonicalize_payload($unsigned_payload), true)), '+/', '-_'), '=');
        if (!hash_equals($expected_payload_hash, $payload_hash)) {
            return new WP_Error('payload_hash_mismatch', 'Publish request payload hash mismatch.');
        }

        $message = $this->build_request_signature_message($action, $pairing_id, $timestamp, $nonce, $payload_hash);
        if (!$this->verify_signature($public_key, $message, $signature)) {
            return new WP_Error('invalid_signature', 'Publish request signature verification failed.');
        }

        set_transient($nonce_key, 1, 10 * MINUTE_IN_SECONDS);

        return $client;
    }

    private function canonicalize_payload($value)
    {
        if (is_array($value)) {
            if (array_keys($value) === range(0, count($value) - 1)) {
                $parts = array();
                foreach ($value as $item) {
                    $parts[] = $this->canonicalize_payload($item);
                }
                return '[' . implode(',', $parts) . ']';
            }

            $copy = $value;
            ksort($copy, SORT_STRING);
            $parts = array();
            foreach ($copy as $key => $item) {
                $parts[] = wp_json_encode((string) $key) . ':' . $this->canonicalize_payload($item);
            }
            return '{' . implode(',', $parts) . '}';
        }

        return wp_json_encode($value);
    }

    private function build_request_signature_message($action, $pairing_id, $timestamp, $nonce, $payload_hash)
    {
        return implode("\n", array(
            (string) $action,
            (string) $pairing_id,
            (string) $timestamp,
            (string) $nonce,
            (string) $payload_hash,
        ));
    }

    private function sanitize_local_slug($value)
    {
        $slug = $this->plugin->storage->sanitize_slug($value);
        return is_string($slug) ? $slug : '';
    }

    private function sanitize_publish_filename($value)
    {
        $raw = str_replace('\\', '/', (string) $value);
        $raw = ltrim($raw, '/');
        if ($raw === '' || strpos($raw, "\0") !== false) {
            return '';
        }
        $parts = explode('/', $raw);
        foreach ($parts as $part) {
            if ($part === '' || $part === '.' || $part === '..') {
                return '';
            }
            // Allow regular filenames (including spaces/punctuation) but block
            // control characters and traversal-like segments.
            if (preg_match('/[\x00-\x1F\x7F]/', $part)) {
                return '';
            }
        }
        return implode('/', $parts);
    }

    private function sanitize_media_sync_filename($value)
    {
        return $this->sanitize_publish_filename($value);
    }

    private function sanitize_chunk_info($payload)
    {
        $chunk_index = isset($payload['chunkIndex']) ? intval($payload['chunkIndex']) : 0;
        $total_chunks = isset($payload['totalChunks']) ? intval($payload['totalChunks']) : 1;
        if ($chunk_index < 0) {
            return new WP_Error('invalid_chunk_index', 'chunkIndex must be zero or greater.');
        }
        if ($total_chunks < 1) {
            return new WP_Error('invalid_total_chunks', 'totalChunks must be at least 1.');
        }
        if ($chunk_index >= $total_chunks) {
            return new WP_Error('chunk_out_of_range', 'chunkIndex must be less than totalChunks.');
        }
        return array(
            'chunkIndex' => $chunk_index,
            'totalChunks' => $total_chunks,
        );
    }

    private function is_publish_file_allowed($filename)
    {
        $lower = strtolower($filename);
        if ($lower === 'manifest.json') {
            return true;
        }
        if (preg_match('/\.html?$/i', $lower)) {
            return false;
        }

        if (strpos($lower, '_resources/') === 0 && strpos($lower, '_resources/_media/') !== 0) {
            return false;
        }

        $ext = strtolower(pathinfo($lower, PATHINFO_EXTENSION));
        if ($ext === '') {
            return false;
        }

        $settings = $this->plugin->get_settings();
        $allowed = isset($settings['allowed_extensions']) ? strtolower((string) $settings['allowed_extensions']) : '';
        $parts = array_values(array_filter(array_map('trim', explode(',', $allowed))));
        if (empty($parts)) {
            $parts = array('md', 'yml', 'yaml', 'json', 'css', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm', 'mp3', 'wav', 'm4a', 'pdf');
        }
        return in_array($ext, $parts, true);
    }

    private function sanitize_manifest($manifest)
    {
        if (!is_array($manifest)) {
            return new WP_Error('invalid_manifest', 'manifest must be a JSON object.');
        }

        $files = isset($manifest['files']) && is_array($manifest['files']) ? $manifest['files'] : array();
        $sanitized_files = array();
        foreach ($files as $item) {
            if (!is_array($item)) {
                continue;
            }
            $filename = $this->sanitize_publish_filename(isset($item['filename']) ? $item['filename'] : '');
            if ($filename === '') {
                continue;
            }
            if (!$this->is_publish_file_allowed($filename)) {
                continue;
            }
            $modified = isset($item['modified']) ? sanitize_text_field((string) $item['modified']) : '';
            $sanitized_files[] = array(
                'filename' => $filename,
                'modified' => $modified,
            );
        }

        $manifest['files'] = $sanitized_files;
        return $manifest;
    }

    private function sanitize_media_manifest($manifest)
    {
        if (!is_array($manifest)) {
            return new WP_Error('invalid_manifest', 'manifest must be a JSON object.');
        }

        $files = isset($manifest['files']) && is_array($manifest['files']) ? $manifest['files'] : array();
        $sanitized_files = array();
        foreach ($files as $item) {
            if (!is_array($item)) {
                continue;
            }
            $filename = $this->sanitize_media_sync_filename(isset($item['filename']) ? $item['filename'] : '');
            if ($filename === '' || !$this->is_media_sync_file_allowed($filename)) {
                continue;
            }
            $modified = isset($item['modified']) ? sanitize_text_field((string) $item['modified']) : '';
            $sanitized_files[] = array(
                'filename' => $filename,
                'modified' => $modified,
            );
        }

        $manifest['files'] = $sanitized_files;
        return $manifest;
    }

    private function read_server_manifest($remote_dir)
    {
        $manifest_path = $this->safe_join_existing_or_future($remote_dir, 'manifest.json');
        if (!$manifest_path || !is_file($manifest_path)) {
            return array('files' => array());
        }
        $raw = file_get_contents($manifest_path);
        if (!is_string($raw) || $raw === '') {
            return array('files' => array());
        }
        $parsed = json_decode($raw, true);
        if (!is_array($parsed)) {
            return array('files' => array());
        }
        return $parsed;
    }

    private function read_media_server_manifest($media_dir)
    {
        $manifest_path = $this->safe_join_existing_or_future($media_dir, 'manifest.json');
        if (!$manifest_path || !is_file($manifest_path)) {
            return array('files' => array());
        }
        $raw = file_get_contents($manifest_path);
        if (!is_string($raw) || $raw === '') {
            return array('files' => array());
        }
        $parsed = json_decode($raw, true);
        if (!is_array($parsed)) {
            return array('files' => array());
        }
        return $parsed;
    }

    private function is_media_sync_file_allowed($filename)
    {
        $lower = strtolower((string) $filename);
        if ($lower === '' || preg_match('/\.html?$/i', $lower)) {
            return false;
        }
        $ext = strtolower(pathinfo($lower, PATHINFO_EXTENSION));
        if ($ext === '') {
            return false;
        }

        $settings = $this->plugin->get_settings();
        $allowed = isset($settings['allowed_extensions']) ? strtolower((string) $settings['allowed_extensions']) : '';
        $parts = array_values(array_filter(array_map('trim', explode(',', $allowed))));
        if (empty($parts)) {
            $parts = array('md', 'yml', 'yaml', 'json', 'css', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm', 'mp3', 'wav', 'm4a', 'pdf');
        }
        $parts[] = 'json';
        return in_array($ext, array_values(array_unique($parts)), true);
    }

    private function write_chunked_file($final_path, $decoded, $chunk_info, $context = array())
    {
        $chunk_index = intval($chunk_info['chunkIndex']);
        $total_chunks = intval($chunk_info['totalChunks']);
        $temp_path = $this->build_chunk_temp_path($final_path, $context);

        if ($chunk_index === 0) {
            if (file_put_contents($temp_path, $decoded) === false) {
                return new WP_Error('chunk_write_failed', 'Failed to write first upload chunk.');
            }
        } else {
            if (!is_file($temp_path)) {
                return new WP_Error('missing_chunk_state', 'Upload chunk state missing on server.');
            }
            if (file_put_contents($temp_path, $decoded, FILE_APPEND) === false) {
                return new WP_Error('chunk_append_failed', 'Failed to append upload chunk.');
            }
        }

        if ($chunk_index < ($total_chunks - 1)) {
            return array('complete' => false);
        }

        if (is_file($final_path)) {
            @unlink($final_path);
        }
        if (!@rename($temp_path, $final_path)) {
            $copied = @copy($temp_path, $final_path);
            if (!$copied) {
                return new WP_Error('chunk_finalize_failed', 'Failed to finalize uploaded file.');
            }
            @unlink($temp_path);
        }
        return array('complete' => true);
    }

    private function build_chunk_temp_path($final_path, $context = array())
    {
        $seed = implode('|', array(
            (string) ($context['scope'] ?? ''),
            (string) ($context['pairing_id'] ?? ''),
            (string) ($context['remote_slug'] ?? ''),
            (string) ($context['filename'] ?? ''),
        ));
        $hash = hash('sha256', $seed !== '' ? $seed : $final_path);
        return $final_path . '.upload-' . substr($hash, 0, 16) . '.part';
    }

    private function manifest_files_map($manifest)
    {
        $map = array();
        $files = isset($manifest['files']) && is_array($manifest['files']) ? $manifest['files'] : array();
        foreach ($files as $item) {
            if (!is_array($item)) {
                continue;
            }
            $filename = isset($item['filename']) ? (string) $item['filename'] : '';
            if ($filename === '') {
                continue;
            }
            $map[$filename] = $item;
        }
        return $map;
    }

    private function iso_to_timestamp($value)
    {
        $ts = strtotime((string) $value);
        return $ts ? (int) $ts : 0;
    }

    private function detect_server_max_publish_request_bytes()
    {
        $settings = $this->plugin->get_settings();
        $configured_mb = isset($settings['max_publish_request_mb']) ? intval($settings['max_publish_request_mb']) : 0;
        $configured_bytes = $configured_mb > 0 ? $configured_mb * 1024 * 1024 : 0;

        $php_upload = $this->parse_ini_size_to_bytes(ini_get('upload_max_filesize'));
        $php_post = $this->parse_ini_size_to_bytes(ini_get('post_max_size'));
        $php_limit = 0;
        if ($php_upload > 0 && $php_post > 0) {
            $php_limit = min($php_upload, $php_post);
        } elseif ($php_upload > 0) {
            $php_limit = $php_upload;
        } elseif ($php_post > 0) {
            $php_limit = $php_post;
        }

        if ($configured_bytes > 0 && $php_limit > 0) {
            return min($configured_bytes, $php_limit);
        }
        if ($configured_bytes > 0) {
            return $configured_bytes;
        }
        return $php_limit;
    }

    private function parse_ini_size_to_bytes($value)
    {
        $raw = trim((string) $value);
        if ($raw === '') {
            return 0;
        }

        if (!preg_match('/^(\d+(?:\.\d+)?)\s*([kmgtp]?)(?:b)?$/i', $raw, $matches)) {
            return 0;
        }

        $number = (float) $matches[1];
        $unit = strtolower($matches[2]);
        $multiplier = 1;
        switch ($unit) {
            case 'k':
                $multiplier = 1024;
                break;
            case 'm':
                $multiplier = 1024 * 1024;
                break;
            case 'g':
                $multiplier = 1024 * 1024 * 1024;
                break;
            case 't':
                $multiplier = 1024 * 1024 * 1024 * 1024;
                break;
            case 'p':
                $multiplier = 1024 * 1024 * 1024 * 1024 * 1024;
                break;
        }

        return (int) floor($number * $multiplier);
    }

    private function safe_join_existing_or_future($base_dir, $rel)
    {
        $base = wp_normalize_path((string) $base_dir);
        $target = wp_normalize_path($base . '/' . ltrim((string) $rel, '/'));
        $prefix = rtrim($base, '/') . '/';
        if (strpos($target, $prefix) !== 0) {
            return null;
        }
        return $target;
    }

    private function find_paired_client($pairing_id)
    {
        $pairing_id = (string) $pairing_id;
        $items = $this->list_paired_clients();
        foreach ($items as $item) {
            if ((string) ($item['pairing_id'] ?? '') === $pairing_id) {
                return $item;
            }
        }
        return null;
    }

    private function list_publish_maps()
    {
        $items = get_option(self::OPTION_PUBLISH_MAPS, array());
        return is_array($items) ? $items : array();
    }

    private function resolve_remote_slug($paired_client, $local_slug)
    {
        $pairing_id = (string) ($paired_client['pairing_id'] ?? '');
        $client_instance_id = (string) ($paired_client['client_instance_id'] ?? '');
        $maps = $this->list_publish_maps();

        foreach ($maps as $map) {
            if ((string) ($map['pairing_id'] ?? '') === $pairing_id && (string) ($map['local_slug'] ?? '') === $local_slug) {
                $remote = $this->plugin->storage->sanitize_slug((string) ($map['remote_slug'] ?? ''));
                if ($remote !== '') {
                    return $remote;
                }
            }
        }

        $candidate_base = $this->plugin->storage->sanitize_slug($local_slug);
        if ($candidate_base === '') {
            $candidate_base = 'presentation';
        }

        $candidate = $candidate_base;
        $suffix = substr(preg_replace('/[^a-z0-9]/', '', strtolower($pairing_id)), 0, 6);
        if ($suffix === '') {
            $suffix = 'peer';
        }

        $is_conflict = function ($slug_to_test) use ($maps, $pairing_id, $local_slug) {
            foreach ($maps as $item) {
                if ((string) ($item['remote_slug'] ?? '') !== $slug_to_test) {
                    continue;
                }
                if ((string) ($item['pairing_id'] ?? '') === $pairing_id && (string) ($item['local_slug'] ?? '') === $local_slug) {
                    return false;
                }
                return true;
            }
            return false;
        };

        $i = 0;
        while (is_dir((string) $this->plugin->storage->presentation_dir($candidate)) || $is_conflict($candidate)) {
            $i += 1;
            $candidate = $candidate_base . '-' . $suffix . ($i > 1 ? '-' . $i : '');
            if ($i > 9999) {
                $candidate = $candidate_base . '-' . $suffix . '-' . time();
                break;
            }
        }

        $new_map = array(
            'pairing_id' => $pairing_id,
            'client_instance_id' => $client_instance_id,
            'local_slug' => $local_slug,
            'remote_slug' => $candidate,
            'created_at' => gmdate('c'),
            'updated_at' => gmdate('c'),
        );
        $this->upsert_publish_map($new_map);
        return $candidate;
    }

    private function upsert_publish_map($record)
    {
        $maps = $this->list_publish_maps();
        $updated = false;
        foreach ($maps as $idx => $item) {
            if ((string) ($item['pairing_id'] ?? '') === (string) ($record['pairing_id'] ?? '')
                && (string) ($item['local_slug'] ?? '') === (string) ($record['local_slug'] ?? '')) {
                $record['created_at'] = (string) ($item['created_at'] ?? $record['created_at']);
                $record['updated_at'] = gmdate('c');
                $maps[$idx] = $record;
                $updated = true;
                break;
            }
        }
        if (!$updated) {
            $maps[] = $record;
        }
        update_option(self::OPTION_PUBLISH_MAPS, array_values($maps), false);
    }

    private function upsert_pair_request($record)
    {
        $items = $this->list_pair_requests();
        $key_id = (string) ($record['request_id'] ?? '');
        $updated = false;

        foreach ($items as $idx => $item) {
            if (($item['request_id'] ?? '') === $key_id) {
                $items[$idx] = $record;
                $updated = true;
                break;
            }
            $instance_id = (string) ($record['client_instance_id'] ?? '');
            if ($instance_id !== '' && ($item['client_instance_id'] ?? '') === $instance_id && ($item['status'] ?? '') === 'pending') {
                $items[$idx] = $record;
                $updated = true;
                break;
            }
        }

        if (!$updated) {
            $items[] = $record;
        }

        update_option(self::OPTION_PAIR_REQUESTS, array_values($items), false);
    }

    private function find_pair_request($request_id)
    {
        $request_id = sanitize_text_field((string) $request_id);
        $items = $this->list_pair_requests();
        foreach ($items as $item) {
            if (($item['request_id'] ?? '') === $request_id) {
                return $item;
            }
        }
        return null;
    }

    private function upsert_paired_client($record)
    {
        $items = $this->list_paired_clients();
        $updated = false;

        $instance_id = isset($record['client_instance_id']) ? (string) $record['client_instance_id'] : '';
        $pairing_id = isset($record['pairing_id']) ? (string) $record['pairing_id'] : '';

        foreach ($items as $idx => $item) {
            $existing_instance_id = isset($item['client_instance_id']) ? (string) $item['client_instance_id'] : '';
            $existing_pairing_id = isset($item['pairing_id']) ? (string) $item['pairing_id'] : '';
            if (($pairing_id !== '' && $existing_pairing_id === $pairing_id) || ($instance_id !== '' && $existing_instance_id === $instance_id)) {
                $items[$idx] = $record;
                $updated = true;
                break;
            }
        }

        if (!$updated) {
            $items[] = $record;
        }

        update_option(self::OPTION_PAIRED_CLIENTS, array_values($items), false);
    }

    private function verify_signature($public_key, $challenge, $signature)
    {
        if (!function_exists('openssl_verify')) {
            return false;
        }

        $public_res = @openssl_pkey_get_public($public_key);
        if (!$public_res) {
            return false;
        }

        $decoded_signature = base64_decode($signature, true);
        if ($decoded_signature === false) {
            return false;
        }

        return openssl_verify($challenge, $decoded_signature, $public_res, OPENSSL_ALGO_SHA256) === 1;
    }

    private function generate_challenge()
    {
        return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    }

    private function get_request_ip()
    {
        if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
            $parts = explode(',', sanitize_text_field(wp_unslash($_SERVER['HTTP_X_FORWARDED_FOR'])));
            return trim($parts[0]);
        }
        if (!empty($_SERVER['REMOTE_ADDR'])) {
            return sanitize_text_field(wp_unslash($_SERVER['REMOTE_ADDR']));
        }
        return '';
    }
}
