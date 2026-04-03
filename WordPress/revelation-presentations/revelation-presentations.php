<?php
/**
 * Plugin Name: REVELation Presentations
 * Description: Upload and host REVELation presentation ZIP exports with sanitized runtime rendering.
 * Version: 1.0.7
 * Author: REVELation
 * License: MIT
 * License URI: https://opensource.org/licenses/MIT
 */

if (!defined('ABSPATH')) {
    exit;
}

define('RP_PLUGIN_VERSION', '1.0.7');
define('RP_PLUGIN_FILE', __FILE__);
define('RP_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('RP_PLUGIN_URL', plugin_dir_url(__FILE__));

// auto-load dependencies if composer has been used to install them.  This is
// how the inline markdown rendering utilises league/commonmark without
// bundling the entire library in our own repository.
$autoload = RP_PLUGIN_DIR . 'vendor/autoload.php';
if (is_readable($autoload)) {
    require_once $autoload;
} else {
    // fall back to bundled libraries if composer wasn't used
    $require_php_tree = static function ($dir, $classOrInterface = null) {
        if (!is_dir($dir)) {
            return;
        }

        if ($classOrInterface !== null && (class_exists($classOrInterface) || interface_exists($classOrInterface))) {
            return;
        }

        $files = array();
        $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir));
        foreach ($iterator as $file) {
            if ($file->isFile() && $file->getExtension() === 'php') {
                $files[] = $file->getPathname();
            }
        }

        usort($files, static function ($a, $b) {
            $a_name = basename($a);
            $b_name = basename($b);
            $a_rank = strpos($a_name, 'Interface.php') !== false ? 0 : (strpos($a_name, 'Trait.php') !== false ? 1 : 2);
            $b_rank = strpos($b_name, 'Interface.php') !== false ? 0 : (strpos($b_name, 'Trait.php') !== false ? 1 : 2);

            if ($a_rank === $b_rank) {
                return strcmp($a, $b);
            }

            return $a_rank - $b_rank;
        });

        foreach ($files as $file) {
            require_once $file;
        }
    };

    $nette_utils_dir = RP_PLUGIN_DIR . 'vendor/nette/utils/src';
    // Load nette/utils base files in dependency order. Nette names traits SmartObject.php /
    // StaticClass.php (no "Trait" suffix), so the generic alphabetical sorter would load
    // Iterators/CachingIterator.php (which uses SmartObject) before SmartObject.php (I < S).
    // Similarly, compatibility.php calls class_alias on HtmlStringable and Translator, so
    // those interfaces must be loaded first.
    foreach ([
        'exceptions.php',      // exception classes; no deps
        'HtmlStringable.php',  // interface; used by compatibility.php
        'Translator.php',      // interface; used by compatibility.php
        'compatibility.php',   // aliases; depends on the two above
        'SmartObject.php',     // trait; used by Iterators/* classes
        'StaticClass.php',     // trait
    ] as $_nette_base) {
        $_f = $nette_utils_dir . '/' . $_nette_base;
        if (is_readable($_f)) {
            require_once $_f;
        }
    }
    unset($_nette_base, $_f);
    $require_php_tree($nette_utils_dir, '\\Nette\\Utils\\Arrays');

    $nette_schema_dir = RP_PLUGIN_DIR . 'vendor/nette/schema/src';
    // nette/schema uses plain names for interfaces/traits (Schema.php, DynamicParameter.php,
    // Elements/Base.php), so the generic sorter can't detect them. Load in dependency order:
    // interfaces first, then the Base trait, then everything else via $require_php_tree.
    foreach ([
        'Schema/DynamicParameter.php',  // interface; no deps
        'Schema/Schema.php',            // interface; no deps
        'Schema/Elements/Base.php',     // trait; used by AnyOf, Type, Structure
    ] as $_schema_base) {
        $_f = $nette_schema_dir . '/' . $_schema_base;
        if (is_readable($_f)) {
            require_once $_f;
        }
    }
    unset($_schema_base, $_f);
    $require_php_tree($nette_schema_dir, '\\Nette\\Schema\\Expect');

    $dot_access_dir = RP_PLUGIN_DIR . 'vendor/dflydev/dot-access-data/src';
    $require_php_tree($dot_access_dir, '\\Dflydev\\DotAccessData\\Data');
    
    // Load CommonMark dependencies first
    $config_dir = RP_PLUGIN_DIR . 'vendor/league/config/src';
    if (is_dir($config_dir) && !interface_exists('\\League\\Config\\ConfigurationProviderInterface')) {
        // Load config library with proper dependency order
        $interface_order = [
            'ConfigurationInterface.php',
            'MutableConfigurationInterface.php', 
            'SchemaBuilderInterface.php',
            'ConfigurationBuilderInterface.php',
            'ConfigurationAwareInterface.php',
            'ConfigurationProviderInterface.php',
            'Exception/ConfigurationExceptionInterface.php'
        ];
        
        // Load interfaces in dependency order first
        foreach ($interface_order as $interface_file) {
            $file_path = $config_dir . '/' . $interface_file;
            if (is_readable($file_path)) {
                require_once $file_path;
            }
        }
        
        // Then load remaining files (classes and exceptions)
        $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($config_dir));
        foreach ($iterator as $file) {
            if ($file->isFile() && $file->getExtension() === 'php' && !in_array($file->getBasename(), $interface_order)) {
                require_once $file->getPathname();
            }
        }
    }

    $psr_dir = RP_PLUGIN_DIR . 'vendor/psr/event-dispatcher/src';
    if (is_dir($psr_dir) && !interface_exists('\\Psr\\EventDispatcher\\EventDispatcherInterface')) {
        // Load PSR library with interfaces first
        $files = [];
        $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($psr_dir));
        foreach ($iterator as $file) {
            if ($file->isFile() && $file->getExtension() === 'php') {
                $files[] = $file->getPathname();
            }
        }
        // Separate interfaces and implementations, sort each group alphabetically
        $interfaces = [];
        $implementations = [];
        foreach ($files as $file) {
            if (strpos($file, 'Interface.php') !== false) {
                $interfaces[] = $file;
            } else {
                $implementations[] = $file;
            }
        }
        sort($interfaces);
        sort($implementations);
        $files = array_merge($interfaces, $implementations);
        foreach ($files as $file) {
            require_once $file;
        }
    }

    $symfony_deprecation_dir = RP_PLUGIN_DIR . 'vendor/symfony/deprecation-contracts';
    if (is_dir($symfony_deprecation_dir) && !function_exists('trigger_deprecation')) {
        $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($symfony_deprecation_dir));
        foreach ($iterator as $file) {
            if ($file->isFile() && $file->getExtension() === 'php') {
                require_once $file->getPathname();
            }
        }
    }

    $symfony_polyfill_dir = RP_PLUGIN_DIR . 'vendor/symfony/polyfill-php80';
    if (is_dir($symfony_polyfill_dir) && !function_exists('str_starts_with')) {
        $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($symfony_polyfill_dir));
        foreach ($iterator as $file) {
            if ($file->isFile() && $file->getExtension() === 'php') {
                require_once $file->getPathname();
            }
        }
    }

    $commonmark_dir = RP_PLUGIN_DIR . 'vendor/league/commonmark/src';
    if (is_dir($commonmark_dir) && !class_exists('\\League\\CommonMark\\CommonMarkConverter')) {
        // Load CommonMark with proper interface dependency order
        $interface_order = [
            // Base interfaces first
            'Extension/ExtensionInterface.php',
            'Input/MarkdownInputInterface.php',
            'Output/RenderedContentInterface.php',
            'Node/StringContainerInterface.php',
            'Node/RawMarkupContainerInterface.php',
            'Parser/Block/BlockContinueParserInterface.php',
            'Parser/Block/BlockContinueParserWithInlinesInterface.php',
            'Delimiter/Processor/DelimiterProcessorInterface.php',
            'Delimiter/Processor/DelimiterProcessorCollectionInterface.php',
            'Renderer/MarkdownRendererInterface.php',
            'Renderer/DocumentRendererInterface.php',
            'Reference/ReferenceInterface.php',
            'Reference/ReferenceMapInterface.php',
            'Normalizer/TextNormalizerInterface.php',
            'Normalizer/UniqueSlugNormalizerInterface.php',
            'Extension/ConfigurableExtensionInterface.php',
            'Environment/EnvironmentBuilderInterface.php',
            'Environment/EnvironmentInterface.php',
            'Exception/CommonMarkException.php'
        ];
        
        // Load known interfaces in dependency order first
        foreach ($interface_order as $interface_file) {
            $file_path = $commonmark_dir . '/' . $interface_file;
            if (is_readable($file_path)) {
                require_once $file_path;
            }
        }
        
        // Then load any remaining interfaces alphabetically
        $files = [];
        $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($commonmark_dir));
        foreach ($iterator as $file) {
            if ($file->isFile() && $file->getExtension() === 'php' && strpos($file->getPathname(), 'Interface.php') !== false) {
                $relative_path = str_replace($commonmark_dir . '/', '', $file->getPathname());
                if (!in_array($relative_path, $interface_order)) {
                    $files[] = $file->getPathname();
                }
            }
        }
        sort($files);
        foreach ($files as $file) {
            require_once $file;
        }
        
        // Finally load non-interface files with class dependency ordering
        $class_order = [
            // Base classes first
            'Node/Node.php',
            'Node/Block/AbstractBlock.php',
            'Node/Inline/AbstractInline.php',
            'Node/Inline/AbstractStringContainer.php',
            'Extension/CommonMark/Node/Inline/AbstractWebResource.php',
            'Parser/Block/AbstractBlockContinueParser.php',
            'Input/MarkdownInput.php',
            'Output/RenderedContent.php',
            'Environment/Environment.php',
            'MarkdownConverter.php',
            'CommonMarkConverter.php',
            'GithubFlavoredMarkdownConverter.php'
        ];
        
        $exception_order = [
            'Exception/LogicException.php',
            'Exception/AlreadyInitializedException.php'
        ];
        
        // Load known classes in dependency order first
        foreach ($class_order as $class_file) {
            $file_path = $commonmark_dir . '/' . $class_file;
            if (is_readable($file_path)) {
                require_once $file_path;
            }
        }
        
        // Load known exceptions in dependency order
        foreach ($exception_order as $exception_file) {
            $file_path = $commonmark_dir . '/' . $exception_file;
            if (is_readable($file_path)) {
                require_once $file_path;
            }
        }
        
        // Then load remaining non-interface files alphabetically
        $files = [];
        $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($commonmark_dir));
        foreach ($iterator as $file) {
            if ($file->isFile() && $file->getExtension() === 'php' && strpos($file->getPathname(), 'Interface.php') === false) {
                $relative_path = str_replace($commonmark_dir . '/', '', $file->getPathname());
                if (!in_array($relative_path, $class_order) && !in_array($relative_path, $exception_order)) {
                    $files[] = $file->getPathname();
                }
            }
        }
        sort($files);
        foreach ($files as $file) {
            require_once $file;
        }
    }
    $parsedown = RP_PLUGIN_DIR . 'vendor/erusev/parsedown/Parsedown.php';
    if (is_readable($parsedown)) {
        require_once $parsedown;
    }
}

require_once RP_PLUGIN_DIR . 'includes/class-rp-plugin.php';

register_activation_hook(RP_PLUGIN_FILE, array('RP_Plugin', 'activate'));
register_deactivation_hook(RP_PLUGIN_FILE, array('RP_Plugin', 'deactivate'));

RP_Plugin::instance();
