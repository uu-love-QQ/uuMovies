package cn.wty5.movies.config

import cn.wty5.movies.model.LocalCategory
import cn.wty5.movies.model.Source
import cn.wty5.movies.model.UserTaxonomyConfig

object DefaultConfig {

    val DEFAULT_CATEGORIES = listOf(
        LocalCategory(id = "movie", name = "电影", bindTags = listOf("#movie")),
        LocalCategory(id = "tv", name = "电视剧", bindTags = listOf("#tv")),
        LocalCategory(id = "anime", name = "动漫", bindTags = listOf("#anime")),
        LocalCategory(id = "variety", name = "综艺", bindTags = listOf("#variety")),
        LocalCategory(id = "short_drama", name = "短剧", bindTags = listOf("#short_drama")),
        LocalCategory(id = "commentary", name = "解说", bindTags = listOf("#commentary")),
        LocalCategory(id = "trailer", name = "预告", bindTags = listOf("#trailer")),
        LocalCategory(id = "sports", name = "体育赛事", bindTags = listOf("#sports")),
        LocalCategory(id = "others", name = "杂项", bindTags = listOf("#others")),
        LocalCategory(id = "18plus", name = "18+", bindTags = listOf("#18plus"))
    )

    val DEFAULT_TAXONOMY = UserTaxonomyConfig(
        adultMode = false,
        categories = DEFAULT_CATEGORIES,
        blockedTags = listOf("#sports", "#trailer"),
        blockedTypeIds = emptyList()
    )

    val DEFAULT_SOURCES = listOf(
        Source(
            id = "lzi",
            name = "量子资源",
            apiUrl = "https://cj.lziapi.com/api.php/provide/vod/from/lzm3u8/",
            apiType = "json",
            enabled = true,
            group = "高速主线",
            adultTypeIds = listOf("34"),
            categoryMapping = mapOf(
                "#sports" to listOf("36", "37", "38", "39", "40"),
                "#tv" to listOf("2", "13", "14", "15", "16", "21", "22", "23", "24"),
                "#short_drama" to listOf("46", "52"),
                "#commentary" to listOf("35"),
                "#18plus" to listOf("34"),
                "#variety" to listOf("3", "25", "26", "27", "28"),
                "#anime" to listOf("4", "29", "30", "31", "32", "33"),
                "#trailer" to listOf("45"),
                "#movie" to listOf("1", "6", "8", "9", "10", "12", "7", "11", "49", "20")
            )
        ),
        Source(
            id = "ffzy",
            name = "非凡资源",
            apiUrl = "https://api.ffzyapi.com/api.php/provide/vod/from/ffm3u8",
            apiType = "json",
            enabled = true,
            group = "高速主线",
            adultTypeIds = listOf("34"),
            categoryMapping = mapOf(
                "#movie" to listOf("1", "6", "7", "8", "9", "10", "11", "12", "20"),
                "#variety" to listOf("3", "25", "26", "27", "28"),
                "#18plus" to listOf("34"),
                "#short_drama" to listOf("36"),
                "#anime" to listOf("4", "29", "30", "31", "32", "33"),
                "#tv" to listOf("2", "13", "14", "15", "16", "21", "22", "23", "24")
            )
        ),
        Source(
            id = "bfzy",
            name = "暴风资源",
            apiUrl = "https://bfzyapi.com/api.php/provide/vod",
            apiType = "json",
            enabled = true,
            group = "高速主线",
            adultTypeIds = listOf("73", "67", "29"),
            categoryMapping = mapOf(
                "#trailer" to listOf("52"),
                "#anime" to listOf("39", "40", "41", "42", "43", "44"),
                "#18plus" to listOf("73", "67", "29"),
                "#short_drama" to listOf("58", "65", "66", "68", "69", "70", "71", "72", "74", "59", "60", "61", "62", "63", "64"),
                "#sports" to listOf("53", "54", "55", "56", "57"),
                "#variety" to listOf("45", "46", "47", "48", "49"),
                "#tv" to listOf("30", "31", "32", "33", "34", "35", "36", "37", "38"),
                "#movie" to listOf("20", "21", "23", "24", "25", "27", "22", "26", "50", "28"),
                "#commentary" to listOf("51")
            )
        ),
        Source(
            id = "snzy",
            name = "索尼资源",
            apiUrl = "https://suoniapi.com/api.php/provide/vod/from/snm3u8",
            apiType = "json",
            enabled = true,
            group = "备用专线",
            adultTypeIds = listOf("55", "56", "57", "58", "59", "61", "73", "60"),
            categoryMapping = mapOf(
                "#anime" to listOf("4", "29", "30", "31", "44", "45", "63"),
                "#variety" to listOf("3", "25", "26", "27", "28"),
                "#sports" to listOf("48", "49", "50", "52", "53"),
                "#tv" to listOf("2", "13", "14", "15", "16", "17", "18", "19", "23", "72"),
                "#others" to listOf("47", "75", "77"),
                "#trailer" to listOf("51", "74"),
                "#movie" to listOf("1", "6", "8", "9", "10", "12", "62", "70", "71", "7", "11", "20", "39"),
                "#18plus" to listOf("55", "56", "57", "58", "59", "61", "73", "60"),
                "#short_drama" to listOf("54", "65", "66", "67", "64", "68", "69", "76")
            )
        ),
        Source(
            id = "jszy",
            name = "极速资源",
            apiUrl = "https://jszyapi.com/api.php/provide/vod/from/jsm3u8",
            apiType = "json",
            enabled = true,
            group = "备用专线",
            adultTypeIds = listOf("8", "53"),
            categoryMapping = mapOf(
                "#18plus" to listOf("8", "53"),
                "#variety" to listOf("27", "30", "31", "32", "33"),
                "#anime" to listOf("17", "24", "25", "26"),
                "#sports" to listOf("29", "40", "41", "42", "43"),
                "#trailer" to listOf("39"),
                "#movie" to listOf("2", "9", "10", "12", "13", "15", "34", "35", "36", "37", "11", "14", "16", "23"),
                "#short_drama" to listOf("38", "45", "46", "47", "48", "49", "50", "52", "54"),
                "#tv" to listOf("1", "3", "4", "5", "6", "7", "20", "28")
            )
        ),
        Source(
            id = "hyzy",
            name = "虎牙资源",
            apiUrl = "https://www.huyaapi.com/api.php/provide/vod/from/hym3u8",
            apiType = "json",
            enabled = true,
            group = "备用专线",
            adultTypeIds = listOf("8", "49"),
            categoryMapping = mapOf(
                "#anime" to listOf("17", "24", "25", "26"),
                "#tv" to listOf("3", "4", "5", "6", "7", "20", "28", "1"),
                "#trailer" to listOf("31"),
                "#sports" to listOf("29", "32", "33", "34", "35"),
                "#movie" to listOf("2", "9", "10", "12", "13", "15", "11", "14", "16", "23"),
                "#short_drama" to listOf("30", "42", "43", "44", "45", "46", "47", "48", "50"),
                "#variety" to listOf("27", "38", "39", "40", "41"),
                "#18plus" to listOf("8", "49")
            )
        )
    )
}
